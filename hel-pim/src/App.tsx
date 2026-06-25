import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import {
  Database, Wrench, Plus, ChevronRight, ChevronLeft,
  Save, X, Check, AlertCircle, Copy, Trash2, FileSpreadsheet, Loader2,
  Cloud, CloudOff, BookOpen, GripVertical, FlipHorizontal
} from 'lucide-react'
import { BrakelineCatalog } from './BrakelineCatalog'
import { FittingsCatalog } from './FittingsCatalog'

// ==================== TYPES ====================
interface Analog { brand: string; code: string }
interface CrossRef { oem: string }
interface OemData {
  helCode: string; partName: string; position: string; oem: string
  crossRefs: CrossRef[]; analogs: Analog[]
  source: string; confidence: string; comment: string; applicability: string
}
interface HoseLine {
  fitting1: string; fitting1_extra: string; insert1: string; bend1: string; bend1_orient?: string; bolt1: string; cut: string
  supports: string[]
  supportsFlipped?: boolean[]  // зеркальное отображение фото крепления (по индексу supports)
  fitting2: string; fitting2_extra: string; insert2: string; bend2: string; bend2_orient?: string; bolt: string
}
interface SchemeData {
  oemNumber: string; position: string; side: string; totalLength: string
  lines: HoseLine[]; quantity: string; alignment: string; noteRus: string; noteEng: string
  hoseColor: string
}
interface SavedRecord {
  id: string; oem: OemData; scheme: SchemeData | null; createdAt: string
  status: 'draft' | 'step1' | 'complete'
}

// Product from Supabase products table (price list)
interface Product {
  id: string; sku: string; name: string; full_name: string | null; category: string
  characteristic: string | null; unit: string; image_url: string | null
  price_dealer: number | null; price_gpb_10: number | null
  price_gpb_15: number | null; price_gpb_17: number | null; price_gpb_20: number | null
}
type PriceTier = 'price_dealer' | 'price_gpb_10' | 'price_gpb_15' | 'price_gpb_17' | 'price_gpb_20'
const PRICE_TIERS: { key: PriceTier; label: string }[] = [
  { key: 'price_dealer', label: 'Дилер' },
  { key: 'price_gpb_10', label: 'GPB -10%' },
  { key: 'price_gpb_15', label: 'GPB -15%' },
  { key: 'price_gpb_17', label: 'GPB -17%' },
  { key: 'price_gpb_20', label: 'GPB -20%' },
]
const HOSE_COLORS = [
  { code: 'CLEAR', hex: '#CCCCCC' }, { code: 'BLACK', hex: '#1a1a1a' },
  { code: 'BLUE', hex: '#0066CC' }, { code: 'RED', hex: '#CC0000' },
  { code: 'GREEN-KAWASAKI', hex: '#00AA00' }, { code: 'YELLOW', hex: '#CCCC00' },
  { code: 'ORANGE', hex: '#CC6600' }, { code: 'PURPLE-TRANS', hex: '#660099' },
  { code: 'CARBON', hex: '#444444' }, { code: 'GOLD', hex: '#DAA520' },
  { code: 'PINK', hex: '#FF69B4' }, { code: 'WHITE', hex: '#F5F5F5' },
  { code: 'BLUE-TINT', hex: '#6699CC' }, { code: 'RED-TINT', hex: '#CC6666' },
]

// ==================== CONSTANTS ====================
const SIDES = ['LEFT', 'RIGHT', 'LEFT/RIGHT', 'LEFT(Drum)', 'RIGHT(Drum)', 'LEFT(Disc)', 'RIGHT(Disc)']
const BRANDS = ['ATE', 'Bosch', 'Dorman', 'TRW', 'Masumo', 'HEL', 'Другой']
const PART_NAMES = ['Тормозной шланг', 'Шланг сцепления', 'Тормозная трубка']

type CatalogItem = { code: string; desc: string; group?: string }
interface Catalogs {
  fittings: CatalogItem[]
  angles: CatalogItem[]
  bendOrients: CatalogItem[]
  inserts: CatalogItem[]
  bolts: CatalogItem[]
  supports: CatalogItem[]
  washers: CatalogItem[]
}
const EMPTY_CATALOGS: Catalogs = { fittings: [], angles: [], bendOrients: [], inserts: [], bolts: [], supports: [], washers: [] }

// Шайбы: по умолчанию 2 на болт; для серии H161 — 3, для H160 — 2.
const WASHER_SKU = 'CCW-10'
const washersForBolt = (boltSku: string): number => {
  const m = (boltSku || '').toUpperCase().match(/^H?(\d{3})/)
  if (m && m[1] === '161') return 3
  return 2 // H160 и по умолчанию
}

const FITTING_CAT_LABELS: Record<string, string> = {
  fitting_female: 'Мама', fitting_male: 'Папа', fitting_banjo: 'Банджо',
}
const PRODUCT_CAT_LABELS: Record<string, string> = {
  insert: 'Вставки', banjo_bolt: 'Банджо болты', hardware: 'Крепёж', washer: 'Шайбы',
}

const emptyOem = (): OemData => ({
  helCode: '', partName: 'Тормозной шланг', position: 'FRONT/LEFT/RIGHT',
  oem: '', crossRefs: [{ oem: '' }], analogs: [{ brand: '', code: '' }],
  source: '', confidence: '', comment: '', applicability: ''
})
const emptyLine = (): HoseLine => ({
  fitting1: '', fitting1_extra: '', insert1: '', bend1: '', bend1_orient: '', bolt1: '', cut: '',
  supports: [], supportsFlipped: [],
  fitting2: '', fitting2_extra: '', insert2: '', bend2: '', bend2_orient: '', bolt: ''
})
const emptyScheme = (oem = ''): SchemeData => ({
  oemNumber: oem, position: 'FRONT', side: 'LEFT/RIGHT', totalLength: '',
  lines: [emptyLine()], quantity: '', alignment: '', noteRus: '', noteEng: '',
  hoseColor: 'CLEAR'
})

// HEL-код / артикул шланга = "RT" + оригинальный OEM (только буквы/цифры, верхний регистр).
// Единственный источник правды для артикула — оригинальный OEM номер.
const makeHelCode = (oem: string): string => {
  const clean = (oem || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return clean ? 'RT' + clean : ''
}

// ==================== SUPABASE DATA LAYER ====================
const db = {
  async loadRecords(): Promise<SavedRecord[]> {
    const { data, error } = await supabase
      .from('pim_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return (data || []).map((r: Record<string, unknown>) => ({
      id:        r.id        as string,
      oem:       r.oem_data  as OemData,
      scheme:    r.scheme_data as SchemeData | null,
      createdAt: r.created_at as string,
      status:    r.status    as 'draft' | 'step1' | 'complete',
    }))
  },

  async saveRecord(record: SavedRecord): Promise<string> {
    const row = {
      id:          record.id,
      status:      record.status,
      oem_data:    record.oem,
      scheme_data: record.scheme,
      hel_code:    record.oem.helCode   || null,
      oem_number:  record.oem.oem       || null,
      position:    record.oem.position  || null,
    }
    const { data, error } = await supabase
      .from('pim_records')
      .upsert(row, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) throw error

    // Auto-publish to catalog when complete
    if (record.status === 'complete' && record.scheme) {
      const s = record.scheme
      const specs: Record<string, unknown> = {}

      // Полный массив сегментов (источник истины, без потерь) — все шланги записи.
      specs.lines = s.lines.map(ln => {
        const rawSup = ln.supports || []
        const keep = rawSup.map((sk, idx) => ({ sk, fl: ln.supportsFlipped?.[idx] ?? false })).filter(x => x.sk)
        return {
          fitting1: ln.fitting1 || '', fitting1_extra: ln.fitting1_extra || '',
          insert1: ln.insert1 || '', bend1: ln.bend1 || '', bend1_orient: ln.bend1_orient || '',
          bolt1: ln.bolt1 || '', bolt1_washer: ln.bolt1 ? WASHER_SKU : '', bolt1_washer_qty: ln.bolt1 ? washersForBolt(ln.bolt1) : 0,
          cut: ln.cut || '',
          supports: keep.map(x => x.sk), supports_flipped: keep.map(x => x.fl),
          fitting2: ln.fitting2 || '', fitting2_extra: ln.fitting2_extra || '',
          insert2: ln.insert2 || '', bend2: ln.bend2 || '', bend2_orient: ln.bend2_orient || '',
          bolt2: ln.bolt || '', bolt2_washer: ln.bolt ? WASHER_SKU : '', bolt2_washer_qty: ln.bolt ? washersForBolt(ln.bolt) : 0,
        }
      })

      // Плоский слой = шланг #1 (совместимость с текущим читателем каталога)
      const line = s.lines[0]
      if (line) {
        if (line.fitting1) specs.fitting1 = line.fitting1
        if (line.insert1) specs.insert1 = line.insert1
        if (line.cut) specs.cut = line.cut
        if (line.fitting2) specs.fitting2 = line.fitting2
        if (line.insert2) specs.insert2 = line.insert2
        if (line.bend1) specs.bend1 = line.bend1
        if (line.bend1_orient) specs.bend1_orient = line.bend1_orient
        if (line.bend2) specs.bend2 = line.bend2
        if (line.bend2_orient) specs.bend2_orient = line.bend2_orient
        if (line.bolt1) { specs.bolt1 = line.bolt1; specs.bolt1_washer = WASHER_SKU; specs.bolt1_washer_qty = washersForBolt(line.bolt1) }
        if (line.bolt) { specs.bolt2 = line.bolt; specs.bolt2_washer = WASHER_SKU; specs.bolt2_washer_qty = washersForBolt(line.bolt) }
        if (line.supports?.length) {
          let n = 0
          line.supports.forEach((sk, si) => {
            if (!sk) return
            n++
            specs[`support${n}`] = sk
            if (line.supportsFlipped?.[si]) specs[`support${n}_flip`] = '1'
          })
        }
      }
      // Уровень схемы / мета
      if (s.hoseColor) specs.hose_color = s.hoseColor
      specs.position = s.position
      specs.side = s.side
      if (s.totalLength) specs.overall_length = s.totalLength
      if (s.quantity) specs.quantity = s.quantity
      if (s.noteRus) specs.note_rus = s.noteRus
      if (s.noteEng) specs.note_eng = s.noteEng
      if (record.oem.partName) specs.part_name = record.oem.partName
      if (record.oem.source) specs.source = record.oem.source
      if (record.oem.confidence) specs.confidence = record.oem.confidence
      if (record.oem.comment) specs.comment = record.oem.comment

      // Артикул всегда RT + оригинальный OEM. helCode/HEL- — только запасной вариант, если OEM пуст.
      const article = makeHelCode(record.oem.oem) || record.oem.helCode || ('HEL-' + record.oem.oem)
      // Аналоги (бренд+код) → cross_refs
      const crossRefs = record.oem.analogs
        .filter(a => a.brand && a.code)
        .map(a => `${a.brand.toUpperCase()} ${a.code}`)
        .join(', ')
      // OEM-замены не теряем: original_oem = основной OEM + все кросс-OEM
      const crossOems = (record.oem.crossRefs || []).map(c => c.oem).filter(Boolean)
      const originalOem = Array.from(new Set([record.oem.oem, ...crossOems].filter(Boolean))).join(', ')
      const application = record.oem.applicability || ''

      await supabase.from('brakeline_products').upsert({
        id: parseInt(record.id.replace(/\D/g, '').slice(0, 15)) || Math.floor(Math.random() * 9000000) + 1000000,
        brand: 'HEL',
        article,
        oem: record.oem.oem || null,
        original_oem: originalOem || record.oem.oem || null,
        status: 1,
        cross_refs: crossRefs || null,
        application: application || null,
        specs,
      }, { onConflict: 'id' })
    }

    return (data as { id: string }).id
  },

  async deleteRecord(id: string): Promise<void> {
    const { error } = await supabase.from('pim_records').delete().eq('id', id)
    if (error) throw error
  },

  async loadCatalogs(): Promise<Catalogs> {
    const [fittingsRes, categoriesRes, anglesRes, orientsRes] = await Promise.all([
      supabase.from('fittings').select('sku, name, size, category_id').eq('is_active', true).order('sku'),
      supabase.from('fitting_categories').select('id, name'),
      supabase.from('fitting_angles').select('name, degrees').order('sort_order'),
      supabase.from('bend_orientations').select('name').eq('is_active', true).order('sort_order'),
    ])
    if (fittingsRes.error) throw new Error(fittingsRes.error.message)
    if (categoriesRes.error) throw new Error(categoriesRes.error.message)
    if (anglesRes.error) throw new Error(anglesRes.error.message)
    if (orientsRes.error) throw new Error(orientsRes.error.message)

    const catMap = new Map(
      (categoriesRes.data || []).map((c: { id: number; name: string }) => [c.id, c.name])
    )
    const fittings: CatalogItem[] = (fittingsRes.data || []).map(
      (f: { sku: string; name: string; size: string | null; category_id: number }) => ({
        code: f.sku,
        desc: `${catMap.get(f.category_id) || ''} ${f.size || ''}`.trim() || f.name,
      })
    )
    const angles: CatalogItem[] = [
      { code: '', desc: '—' },
      ...(anglesRes.data || []).map((a: { name: string; degrees: number | null }) => ({
        code: a.name,
        desc: `${a.name}${a.degrees ? ` (${a.degrees}°)` : ''}`,
      })),
    ]
    const bendOrients: CatalogItem[] = [
      { code: '', desc: '—' },
      ...(orientsRes.data || []).map((o: { name: string }) => ({ code: o.name, desc: o.name })),
    ]
    return { fittings, angles, bendOrients, inserts: [], bolts: [], supports: [], washers: [] }
  },

  async loadProducts(): Promise<Product[]> {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, full_name, category, characteristic, unit, image_url, price_dealer, price_gpb_10, price_gpb_15, price_gpb_17, price_gpb_20')
      .eq('is_active', true)
      .order('sku')
    if (error) throw error
    return (data || []) as Product[]
  },
}

// ==================== PRICE HELPERS ====================
function buildProductMap(products: Product[]): Map<string, Product> {
  const m = new Map<string, Product>()
  for (const p of products) m.set(p.sku, p)
  return m
}

function buildProductCatalogs(products: Product[]): Pick<Catalogs, 'fittings' | 'inserts' | 'bolts' | 'supports' | 'washers'> {
  const fittings: CatalogItem[] = []
  const inserts: CatalogItem[] = []
  const bolts: CatalogItem[] = []
  const supports: CatalogItem[] = []
  const washers: CatalogItem[] = []
  const seen = new Set<string>()

  for (const p of products) {
    const key = p.characteristic ? `${p.sku}|${p.characteristic}` : p.sku
    if (seen.has(key)) continue
    seen.add(key)

    const item: CatalogItem = {
      code: p.sku,
      desc: p.full_name || p.name,
      group: FITTING_CAT_LABELS[p.category] || PRODUCT_CAT_LABELS[p.category] || p.category,
    }

    if (p.category === 'fitting_female' || p.category === 'fitting_male' || p.category === 'fitting_banjo') {
      fittings.push(item)
    } else if (p.category === 'insert') {
      inserts.push(item)
    } else if (p.category === 'banjo_bolt') {
      bolts.push(item)
    } else if (p.category === 'hardware') {
      // Only fittings-related hardware for supports
      if (p.sku.startsWith('HLL') || p.sku.startsWith('PLT') || p.sku.startsWith('RIOBKT') || p.sku.startsWith('HPC') || p.sku.startsWith('CIRCLIP') || p.sku.startsWith('ABS') || p.sku.startsWith('Clip') || p.sku.startsWith('DEMPFER') || p.sku.startsWith('GROMMET') || p.sku.startsWith('2K'))
        supports.push(item)
    } else if (p.category === 'washer') {
      washers.push(item)
    }
  }
  return { fittings, inserts, bolts, supports, washers }
}

function getPrice(pm: Map<string, Product>, sku: string, tier: PriceTier): number {
  const p = pm.get(sku)
  return p ? (p[tier] ?? 0) : 0
}

function fmtRub(n: number): string {
  if (!n) return ''
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽'
}

interface LinePriceBreakdown {
  fitting1: number; insert1: number; bolt1: number; hose: number
  fitting2: number; insert2: number; bolt: number
  supports: number; sleeves: number; washers: number
  washerQty: number; total: number
}

function calcLinePrice(line: HoseLine, hoseColor: string, pm: Map<string, Product>, tier: PriceTier): LinePriceBreakdown {
  const f1 = getPrice(pm, line.fitting1, tier)
  const ins1 = getPrice(pm, line.insert1, tier)
  const ins2 = getPrice(pm, line.insert2, tier)
  const b1 = getPrice(pm, line.bolt1, tier)
  const cutMm = parseFloat(line.cut) || 0
  const hoseProduct = Array.from(pm.values()).find(p => p.sku === 'H707' && p.characteristic === hoseColor)
  const hosePricePerM = hoseProduct ? (hoseProduct[tier] ?? 0) : getPrice(pm, 'H707', tier)
  const hose = (cutMm / 1000) * hosePricePerM
  const f2 = getPrice(pm, line.fitting2, tier)
  const blt = getPrice(pm, line.bolt, tier)
  const supTotal = (line.supports || []).reduce((sum, s) => sum + getPrice(pm, s, tier), 0)
  const sleeves = getPrice(pm, 'H707-03C', tier) * 2
  // Шайбы: по 2 (или 3 для H161) на каждый присутствующий болт
  const washerQty = (line.bolt1 ? washersForBolt(line.bolt1) : 0) + (line.bolt ? washersForBolt(line.bolt) : 0)
  const washers = washerQty * getPrice(pm, WASHER_SKU, tier)
  const total = f1 + ins1 + b1 + ins2 + hose + f2 + blt + supTotal + sleeves + washers
  return { fitting1: f1, insert1: ins1, bolt1: b1, insert2: ins2, hose, fitting2: f2, bolt: blt, supports: supTotal, sleeves, washers, washerQty, total }
}

// ==================== UI PRIMITIVES ====================
const cl = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ')

function Badge({ children, color = 'red' }: { children: React.ReactNode; color?: string }) {
  const c: Record<string, string> = {
    red:    'bg-red-50 text-[#ED1C24] border border-red-200',
    blue:   'bg-blue-50 text-blue-700 border border-blue-200',
    green:  'bg-green-50 text-green-700 border border-green-200',
    orange: 'bg-amber-50 text-amber-700 border border-amber-200',
    gray:   'bg-neutral-100 text-neutral-600 border border-neutral-200',
    purple: 'bg-purple-50 text-purple-700 border border-purple-200',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c[color] || c.red}`}>{children}</span>
}

function Btn({ children, onClick, variant = 'primary', size = 'md', disabled = false, className = '' }: {
  children: React.ReactNode; onClick?: () => void; variant?: string; size?: string
  disabled?: boolean; className?: string
}) {
  const base = 'inline-flex items-center gap-2 font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
  const sz: Record<string, string> = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  const v: Record<string, string> = {
    primary:   'bg-[#ED1C24] hover:bg-[#d41920] text-white shadow-sm',
    secondary: 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 shadow-sm',
    danger:    'bg-red-50 hover:bg-red-100 text-[#ED1C24] border border-red-200',
    success:   'bg-green-600 hover:bg-green-700 text-white shadow-sm',
    ghost:     'hover:bg-neutral-100 text-neutral-500',
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sz[size]} ${v[variant] || v.primary} ${className}`}>
      {children}
    </button>
  )
}

function Field({ label, children, required = false, hint = '' }: {
  label: React.ReactNode; children: React.ReactNode; required?: boolean; hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
        {label}{required && <span className="text-[#ED1C24] ml-0.5">*</span>}
      </label>
      {children}
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </div>
  )
}

function Card({ children, title, accent = false, className = '' }: {
  children: React.ReactNode; title?: string; accent?: boolean; className?: string
}) {
  return (
    <div className={`bg-white border border-neutral-200 rounded-xl p-5 shadow-sm ${accent ? 'border-l-[3px] border-l-[#ED1C24]' : ''} ${className}`}>
      {title && (
        <div className="flex items-center gap-2 mb-4">
          {accent && <div className="w-1 h-4 rounded-full bg-[#ED1C24]" />}
          <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">{title}</h3>
        </div>
      )}
      {children}
    </div>
  )
}

function CatalogSelect({ value, onChange, catalog, placeholder }: {
  value: string; onChange: (v: string) => void
  catalog: CatalogItem[]; placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number; openUp: boolean }>({ top: 0, left: 0, width: 0, openUp: false })
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const selected = catalog.find(c => c.code === value)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (open) { setOpen(false); return }
    setSearch('')
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const openUp = r.bottom + 280 > window.innerHeight
      setPos({ top: openUp ? r.top : r.bottom + 4, left: r.left, width: r.width, openUp })
    }
    setOpen(true)
  }

  const filtered = search
    ? catalog.filter(c => `${c.code} ${c.desc}`.toLowerCase().includes(search.toLowerCase()))
    : catalog

  const hasGroups = filtered.some(c => c.group)
  const groups = new Map<string, CatalogItem[]>()
  if (hasGroups) {
    for (const c of filtered) {
      const g = c.group || '—'
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(c)
    }
  }

  const dropdownContent = (
    <>
      <input value={search} onChange={e => setSearch(e.target.value)} autoFocus
        placeholder="Поиск..." className="px-3 py-2 text-xs border-b border-neutral-100 outline-none font-mono shrink-0" />
      <div className="overflow-y-auto flex-1">
        {value && (
          <button onClick={() => { onChange(''); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-50 cursor-pointer">{placeholder}</button>
        )}
        {hasGroups ? (
          Array.from(groups.entries()).map(([group, items]) => (
            <div key={group}>
              <div className="px-3 py-1 text-[9px] font-bold text-neutral-400 uppercase tracking-widest bg-neutral-50 sticky top-0">{group}</div>
              {items.map(c => (
                <button key={c.code} onClick={() => { onChange(c.code); setOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors ${c.code === value ? 'bg-red-50 text-[#ED1C24]' : 'hover:bg-neutral-50 text-neutral-700'}`}>
                  <span className="font-bold">{c.code}</span> <span className="text-neutral-400">— {c.desc}</span>
                </button>
              ))}
            </div>
          ))
        ) : (
          filtered.map(c => (
            <button key={c.code} onClick={() => { onChange(c.code); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono cursor-pointer transition-colors ${c.code === value ? 'bg-red-50 text-[#ED1C24]' : 'hover:bg-neutral-50 text-neutral-700'}`}>
              <span className="font-bold">{c.code}</span> <span className="text-neutral-400">— {c.desc}</span>
            </button>
          ))
        )}
        {filtered.length === 0 && <div className="px-3 py-3 text-xs text-neutral-400 text-center">Не найдено</div>}
      </div>
    </>
  )

  return (
    <>
      <button ref={btnRef} type="button" onClick={handleOpen}
        className="w-full text-left px-3 py-2 border border-neutral-200 rounded-lg text-xs font-mono bg-white hover:border-neutral-400 cursor-pointer transition-colors truncate">
        {selected ? <>{selected.code} — <span className="text-neutral-500">{selected.desc}</span></> : <span className="text-neutral-400">{placeholder}</span>}
      </button>
      {open && (
        <div ref={dropRef} className="fixed z-[9999] bg-white border border-neutral-200 rounded-lg shadow-2xl max-h-64 flex flex-col"
          style={{
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top + 4 : undefined,
            left: pos.left,
            width: Math.max(pos.width, 280),
          }}>
          {dropdownContent}
        </div>
      )}
    </>
  )
}

// ── Step Indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center">
          <div className="flex items-center gap-2.5">
            <div className={cl(
              'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all shrink-0',
              i < current  && 'bg-green-500 text-white',
              i === current && 'bg-[#ED1C24] text-white ring-4 ring-red-100',
              i > current  && 'bg-neutral-100 text-neutral-400',
            )}>
              {i < current ? <Check size={14} /> : i + 1}
            </div>
            <span className={cl(
              'text-sm font-medium',
              i === current ? 'text-neutral-900' : 'text-neutral-400'
            )}>{s}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cl('w-12 h-px mx-3', i < current ? 'bg-green-400' : 'bg-neutral-200')} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Hose Diagram ───────────────────────────────────────────────────────────────
function PartThumb({ sku, productMap, size = 'md', mirror = false }: { sku: string; productMap: Map<string, Product>; size?: 'sm' | 'md'; mirror?: boolean }) {
  const p = productMap.get(sku)
  const [failed, setFailed] = useState(false)
  const dims = size === 'sm' ? 'w-12 h-12' : 'w-[72px] h-[72px]'
  if (p?.image_url && !failed) {
    return (
      <div className={`${dims} rounded-md overflow-hidden bg-white border border-neutral-200 shrink-0 flex items-center justify-center`} style={mirror ? { transform: 'scaleX(-1)' } : undefined}>
        <img src={p.image_url} alt={sku} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
      </div>
    )
  }
  return null
}

function HoseDiagram({ line, productMap, hoseColor, onSupportsChange }: {
  line: HoseLine; productMap?: Map<string, Product>; hoseColor?: string
  // Если передан — крепления интерактивны (drag-and-drop порядок + зеркало). Иначе режим только чтения.
  onSupportsChange?: (supports: string[], supportsFlipped: boolean[]) => void
}) {
  const f1 = line.fitting1 || ''
  const f2 = line.fitting2 || ''
  const cut = line.cut || '—'
  const pm = productMap || new Map()
  const hc = HOSE_COLORS.find(c => c.code === hoseColor)?.hex || '#555'
  const rawSupports = line.supports || []
  const rawFlipped = rawSupports.map((_, i) => line.supportsFlipped?.[i] ?? false)
  const supports = rawSupports.filter(Boolean)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const interactive = !!onSupportsChange

  // Перемещение крепления (drag-and-drop) — двигаем синхронно код и флаг зеркала
  const moveSupport = (from: number, to: number) => {
    if (!onSupportsChange || from === to) return
    const s = [...rawSupports]; const f = [...rawFlipped]
    const [ms] = s.splice(from, 1); const [mf] = f.splice(from, 1)
    s.splice(to, 0, ms); f.splice(to, 0, mf)
    onSupportsChange(s, f)
  }
  // Зеркальное отражение фото крепления
  const toggleFlip = (idx: number) => {
    if (!onSupportsChange) return
    const f = [...rawFlipped]; f[idx] = !f[idx]
    onSupportsChange([...rawSupports], f)
  }

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-5 mb-4 select-none overflow-x-auto">
      <div className="min-w-[600px]">

        {/* Assembly line: F1 + Ins1 — ═══ HOSE ═══ — Ins2 + F2 */}
        <div className="flex items-start">

          {/* Fitting 1 + Insert 1 — mirrored */}
          <div className="flex items-start gap-1 shrink-0">
            <div className="flex flex-col items-center w-[84px]">
              <PartThumb sku={f1} productMap={pm} mirror />
              <div className="text-[10px] font-bold text-[#ED1C24] mt-1">Фитинг 1</div>
              <div className="font-mono text-[10px] text-neutral-700 font-bold text-center">{f1 || '—'}</div>
              {line.bend1 && <div className="text-[10px] text-amber-600 font-semibold">{line.bend1}</div>}
              {line.bend1_orient && <div className="text-[10px] text-blue-600 font-semibold">↪ {line.bend1_orient}</div>}
            </div>
            {line.insert1 && (
              <div className="flex flex-col items-center w-[84px]">
                <PartThumb sku={line.insert1} productMap={pm} mirror />
                <div className="text-[10px] font-bold text-neutral-500 mt-1">Вставка</div>
                <div className="font-mono text-[10px] text-neutral-700 font-bold text-center">{line.insert1}</div>
              </div>
            )}
          </div>

          {/* Left sleeve */}
          <div className="flex flex-col items-center shrink-0 w-[72px]">
            <div className="w-[72px] h-[72px] rounded-md overflow-hidden bg-white border border-neutral-200 flex items-center justify-center">
              <img src={pm.get('H707-03C')?.image_url || ''} alt="" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="text-[10px] font-bold text-neutral-500 mt-1">Гильза</div>
            <div className="font-mono text-[10px] text-neutral-700 font-bold">H707-03C</div>
          </div>

          {/* Hose body */}
          <div className="flex-1 mx-1 flex flex-col items-center pt-4">
            <div className="w-full h-7 relative overflow-hidden shadow-sm rounded-sm" style={{ background: hc }}>
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: `repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(255,255,255,0.4) 4px, rgba(255,255,255,0.4) 5px)`
              }} />
              <div className="absolute inset-x-0 top-0 h-1.5 bg-white/15" />
              {supports.length > 0 && (
                <div className="absolute inset-0 flex justify-around items-center">
                  {supports.map((_s, i) => (
                    <div key={i} className="w-1.5 h-9 rounded-full bg-amber-500 shadow-sm -mt-1.5" />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1.5">
              <span className="font-mono text-lg font-black text-neutral-900">{cut}</span>
              <span className="text-[10px] text-neutral-400 ml-1">мм</span>
            </div>
          </div>

          {/* Right sleeve — mirrored */}
          <div className="flex flex-col items-center shrink-0 w-[72px]">
            <div className="w-[72px] h-[72px] rounded-md overflow-hidden bg-white border border-neutral-200 flex items-center justify-center" style={{ transform: 'scaleX(-1)' }}>
              <img src={pm.get('H707-03C')?.image_url || ''} alt="" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="text-[10px] font-bold text-neutral-500 mt-1">Гильза</div>
            <div className="font-mono text-[10px] text-neutral-700 font-bold">H707-03C</div>
          </div>

          {/* Insert 2 + Fitting 2 */}
          <div className="flex items-start gap-1 shrink-0">
            {line.insert2 && (
              <div className="flex flex-col items-center w-[84px]">
                <PartThumb sku={line.insert2} productMap={pm} />
                <div className="text-[10px] font-bold text-neutral-500 mt-1">Вставка</div>
                <div className="font-mono text-[10px] text-neutral-700 font-bold text-center">{line.insert2}</div>
              </div>
            )}
            <div className="flex flex-col items-center w-[84px]">
              <PartThumb sku={f2} productMap={pm} />
              <div className="text-[10px] font-bold text-[#ED1C24] mt-1">Фитинг 2</div>
              <div className="font-mono text-[10px] text-neutral-700 font-bold text-center">{f2 || '—'}</div>
              {line.bend2 && <div className="text-[10px] text-amber-600 font-semibold">{line.bend2}</div>}
              {line.bend2_orient && <div className="text-[10px] text-blue-600 font-semibold">↪ {line.bend2_orient}</div>}
            </div>
          </div>
        </div>

        {/* Bottom row: bolt left | supports | bolt right — aligned under fittings */}
        {(line.bolt1 || line.bolt || supports.length > 0) && (
          <div className="flex items-start mt-3 pt-3 border-t border-neutral-200">
            {/* Bolt left — under fitting 1 */}
            <div className="shrink-0 w-[90px] flex flex-col items-center">
              {line.bolt1 && (
                <>
                  <PartThumb sku={line.bolt1} productMap={pm} size="sm" mirror />
                  <div className="text-[10px] font-bold text-neutral-500 mt-1">Болт</div>
                  <div className="font-mono text-[10px] text-neutral-700 font-bold">{line.bolt1}</div>
                  <div className="text-[9px] text-neutral-500 mt-0.5">Шайбы: {WASHER_SKU} ×{washersForBolt(line.bolt1)}</div>
                </>
              )}
            </div>
            {/* Supports — center (drag-and-drop порядок + зеркало) */}
            <div className="flex-1 flex items-center justify-center gap-3 flex-wrap">
              {rawSupports.map((s, i) => s ? (
                <div key={i}
                  draggable={interactive}
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={interactive ? (e => e.preventDefault()) : undefined}
                  onDrop={() => { if (dragIdx !== null) moveSupport(dragIdx, i); setDragIdx(null) }}
                  onDragEnd={() => setDragIdx(null)}
                  className={cl(
                    'flex items-center gap-1.5 rounded-lg px-1.5 py-1 border transition-all',
                    interactive ? 'cursor-grab hover:bg-white hover:border-neutral-200 border-transparent active:cursor-grabbing' : 'border-transparent',
                    dragIdx === i && 'opacity-40 ring-2 ring-[#ED1C24]'
                  )}>
                  {interactive && <GripVertical size={12} className="text-neutral-300 shrink-0" />}
                  <PartThumb sku={s} productMap={pm} size="sm" mirror={rawFlipped[i]} />
                  <div>
                    <div className="text-[10px] font-bold text-neutral-500">Креп {i + 1}</div>
                    <div className="font-mono text-[10px] text-amber-600 font-bold">{s}</div>
                    {interactive && (
                      <button onClick={() => toggleFlip(i)} title="Отразить фото крепления зеркально"
                        className={cl(
                          'mt-0.5 inline-flex items-center gap-1 text-[9px] font-semibold rounded px-1 py-0.5 cursor-pointer transition-colors',
                          rawFlipped[i] ? 'bg-[#ED1C24] text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                        )}>
                        <FlipHorizontal size={10} /> {rawFlipped[i] ? 'Зеркало' : 'Отразить'}
                      </button>
                    )}
                  </div>
                </div>
              ) : null)}
            </div>
            {/* Bolt right — under fitting 2 */}
            <div className="shrink-0 w-[90px] flex flex-col items-center">
              {line.bolt && (
                <>
                  <PartThumb sku={line.bolt} productMap={pm} size="sm" />
                  <div className="text-[10px] font-bold text-neutral-500 mt-1">Болт</div>
                  <div className="font-mono text-[10px] text-neutral-700 font-bold">{line.bolt}</div>
                  <div className="text-[9px] text-neutral-500 mt-0.5">Шайбы: {WASHER_SKU} ×{washersForBolt(line.bolt)}</div>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}



// ==================== QUICK ADD CAR ====================
const QAC_MAKES = ['SUBARU','TOYOTA','NISSAN','HONDA','FORD','BMW','AUDI','VW','MERCEDES-BENZ','MAZDA','HYUNDAI','KIA','MITSUBISHI','VOLVO','PEUGEOT','RENAULT','OPEL','FIAT','CITROEN','CHEVROLET','DODGE','CHRYSLER','SUZUKI','LAND ROVER','JAGUAR','PORSCHE','JEEP','SKODA','SEAT','LADA']
const QAC_MODELS: Record<string, string[]> = {
  SUBARU:['FORESTER','IMPREZA','LEGACY','OUTBACK','XV','CROSSTREK','WRX','BRZ','BAJA','TRIBECA'],
  TOYOTA:['COROLLA','CAMRY','RAV4','LAND CRUISER','HILUX','PRIUS','YARIS','AURIS','AVENSIS','SUPRA'],
  NISSAN:['PATROL','X-TRAIL','QASHQAI','JUKE','ALMERA','PRIMERA','PATHFINDER','NAVARA','MURANO','GT-R'],
  HONDA:['CIVIC','ACCORD','CR-V','HR-V','FIT','JAZZ','INTEGRA','S2000','NSX'],
  FORD:['FOCUS','FIESTA','MONDEO','KUGA','ESCAPE','RANGER','MUSTANG','EXPLORER','TRANSIT'],
  BMW:['1','3','5','7','X1','X3','X5','X6','M3','M5','Z4'],
  AUDI:['A3','A4','A5','A6','A7','A8','Q3','Q5','Q7','Q8','TT'],
  VW:['GOLF','PASSAT','POLO','TIGUAN','TOUAREG','JETTA','BEETLE','CADDY','TRANSPORTER'],
  'MERCEDES-BENZ':['C-CLASS','E-CLASS','S-CLASS','A-CLASS','GLA','GLC','GLE','GLS','ML','G-CLASS'],
  MAZDA:['3','6','CX-3','CX-5','CX-9','MX-5','RX-8'],
  HYUNDAI:['TUCSON','SANTA FE','ELANTRA','SONATA','i30','i20','CRETA','SOLARIS'],
  KIA:['SPORTAGE','CEED','RIO','SORENTO','OPTIMA','SOUL','SELTOS','CERATO'],
}

function QuickAddCar({ onAdd }: { onAdd: (line: string) => void }) {
  const [open, setOpen] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [mod, setMod] = useState('')
  const [yFrom, setYFrom] = useState('')
  const [yTo, setYTo] = useState('')

  const add = () => {
    if (!make) return
    let line = make
    if (model) line += ' ' + model
    if (mod) line += ' (' + mod + ')'
    if (yFrom) line += ' ' + yFrom + (yTo ? '-' + yTo : '-')
    onAdd(line)
    setMake(''); setModel(''); setMod(''); setYFrom(''); setYTo(''); setOpen(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center gap-1 mt-2">
      <Plus size={12} /> Добавить авто
    </button>
  )

  return (
    <div className="mt-2 p-2.5 bg-neutral-50 border border-neutral-200 rounded-lg flex items-center gap-2 flex-wrap">
      <select value={make} onChange={e => { setMake(e.target.value); setModel('') }} className="w-28 text-xs shrink-0">
        <option value="">Марка</option>
        {QAC_MAKES.map(m => <option key={m}>{m}</option>)}
      </select>
      {make && (
        <select value={model} onChange={e => setModel(e.target.value)} className="w-28 text-xs shrink-0">
          <option value="">Модель</option>
          {(QAC_MODELS[make] || []).map(m => <option key={m}>{m}</option>)}
        </select>
      )}
      <input value={mod} onChange={e => setMod(e.target.value)} placeholder="Код" className="w-16 text-xs font-mono shrink-0" />
      <input value={yFrom} onChange={e => setYFrom(e.target.value)} placeholder="с" className="w-14 text-xs font-mono text-center shrink-0" maxLength={4} />
      <span className="text-neutral-300 text-xs">—</span>
      <input value={yTo} onChange={e => setYTo(e.target.value)} placeholder="по" className="w-14 text-xs font-mono text-center shrink-0" maxLength={4} />
      <button onClick={add} disabled={!make} className="px-3 py-1 bg-green-600 text-white rounded text-xs font-bold cursor-pointer hover:bg-green-700 disabled:opacity-40 transition-colors">+</button>
      <button onClick={() => setOpen(false)} className="p-1 text-neutral-400 hover:text-neutral-600 cursor-pointer"><X size={12} /></button>
    </div>
  )
}

// ==================== STEP 1: OEM ====================
interface OemLookupResult {
  status: 'none' | 'has_hel' | 'has_analogs' | 'searching'
  helArticle?: string
  analogs?: { brand: string; article: string; application: string; crossRefs: string }[]
}

function Step1Oem({ data, onChange }: { data: OemData; onChange: (d: OemData) => void }) {
  const u = (key: keyof OemData, val: OemData[keyof OemData]) => onChange({ ...data, [key]: val })
  const addCR = () => u('crossRefs', [...data.crossRefs, { oem: '' }])
  const rmCR = (i: number) => u('crossRefs', data.crossRefs.filter((_, idx) => idx !== i))
  const uCR = (i: number, val: string) => {
    const r = [...data.crossRefs]; r[i] = { oem: val }; u('crossRefs', r)
  }
  const addA = () => u('analogs', [...data.analogs, { brand: '', code: '' }])
  const rmA = (i: number) => u('analogs', data.analogs.filter((_, idx) => idx !== i))
  const uA = (i: number, k: keyof Analog, v: string) => {
    const a = [...data.analogs]; a[i] = { ...a[i], [k]: v }; u('analogs', a)
  }
  const auto = () => { if (data.oem) u('helCode', makeHelCode(data.oem)) }
  // OEM — единственный источник артикула: при вводе сразу синхронизируем helCode = RT + OEM.
  const setOem = (val: string) => onChange({ ...data, oem: val, helCode: makeHelCode(val) })

  // OEM lookup
  const [lookup, setLookup] = useState<OemLookupResult>({ status: 'none' })
  const lookupRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (lookupRef.current) clearTimeout(lookupRef.current)
    const oem = data.oem.trim()
    if (!oem || oem.length < 4) { setLookup({ status: 'none' }); return }
    setLookup({ status: 'searching' })
    lookupRef.current = setTimeout(async () => {
      try {
        const { data: results } = await supabase
          .from('brakeline_products')
          .select('brand, article, oem, original_oem, application, cross_refs')
          .or(`oem.ilike.%${oem}%,original_oem.ilike.%${oem}%`)
          .limit(20)

        if (!results?.length) { setLookup({ status: 'none' }); return }

        const helProduct = results.find(r => r.brand === 'HEL')
        if (helProduct) {
          setLookup({ status: 'has_hel', helArticle: helProduct.article })
          return
        }

        const analogs = results.map(r => ({
          brand: r.brand, article: r.article,
          application: r.application || '', crossRefs: r.cross_refs || ''
        }))
        setLookup({ status: 'has_analogs', analogs })
      } catch { setLookup({ status: 'none' }) }
    }, 500)
    return () => { if (lookupRef.current) clearTimeout(lookupRef.current) }
  }, [data.oem])

  const fillFromLookup = async () => {
    if (lookup.status !== 'has_analogs' || !lookup.analogs?.length) return
    const updates: Partial<OemData> = {}
    const oem = data.oem.trim()

    // Аналоги — бренд + артикул (только наши бренды)
    const knownBrands = new Set(['ATE', 'BOSCH', 'TRW', 'DORMAN'])
    const newAnalogs = lookup.analogs
      .filter(a => knownBrands.has(a.brand))
      .map(a => ({ brand: a.brand, code: a.article }))
    if (newAnalogs.length) updates.analogs = newAnalogs

    // OEM кроссы — вытащить из original_oem (это реальные OEM номера автопроизводителя)
    const oemSet = new Set<string>()
    for (const a of lookup.analogs) {
      // original_oem format: "SUBARU 26540AE010, 26540AE01A" or "AUDI 1K0611701, VW 1K0611701"
      const { data: product } = await supabase
        .from('brakeline_products')
        .select('original_oem')
        .eq('article', a.article)
        .eq('brand', a.brand)
        .limit(1)
        .single()
      if (product?.original_oem) {
        const parts = product.original_oem.split(',').map((s: string) => s.trim()).filter(Boolean)
        for (const p of parts) {
          const clean = p.replace(/^(SUBARU|TOYOTA|HONDA|NISSAN|FORD|BMW|AUDI|VW|MERCEDES|MAZDA|HYUNDAI|KIA)\s+/i, '').trim()
          if (clean && clean !== oem) oemSet.add(clean)
        }
      }
    }
    if (oemSet.size) updates.crossRefs = Array.from(oemSet).slice(0, 10).map(o => ({ oem: o }))

    // Применимость — компактный текст из первого аналога
    const appSet = new Set<string>()
    for (const a of lookup.analogs) {
      const lines = (a.application || '').split('\n').map((s: string) => s.trim()).filter(Boolean)
      for (const l of lines) appSet.add(l)
    }
    if (appSet.size) updates.applicability = Array.from(appSet).join('\n')

    onChange({ ...data, ...updates })
  }

  const POS_OPTIONS = [
    'FRONT/LEFT/RIGHT', 'FRONT LEFT', 'FRONT RIGHT',
    'REAR LEFT', 'REAR RIGHT', 'REAR LEFT/RIGHT',
    'REAR LEFT(Drum)', 'REAR RIGHT(Drum)', 'REAR LEFT(Disc)', 'REAR RIGHT(Disc)',
  ]

  return (
    <div className="space-y-5">
      <Card title="Основная информация">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="OEM номер" required hint="Оригинальный номер производителя">
            <input value={data.oem} onChange={e => setOem(e.target.value)} placeholder="9094702F58" className="font-mono" />
            {lookup.status === 'searching' && <span className="text-[10px] text-neutral-400 mt-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Поиск в базе...</span>}
            {lookup.status === 'has_hel' && (
              <div className="mt-1 px-2.5 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 flex items-center gap-1.5">
                <Check size={12} /> Найден HEL: <span className="font-mono font-bold">{lookup.helArticle}</span>
              </div>
            )}
            {lookup.status === 'has_analogs' && (
              <div className="mt-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-lg text-xs">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={13} className="text-green-600 shrink-0" />
                  <span className="text-green-700 flex-1">Найдены аналоги ({lookup.analogs?.length}), HEL нет</span>
                  <button onClick={fillFromLookup}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold cursor-pointer hover:bg-green-700 transition-colors shrink-0">
                    Заполнить
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {lookup.analogs?.slice(0, 5).map((a, i) => (
                    <span key={i} className="font-mono text-[10px] bg-white text-green-800 px-2 py-0.5 rounded border border-green-200">{a.brand} {a.article}</span>
                  ))}
                </div>
              </div>
            )}
            {lookup.status === 'none' && data.oem.length >= 4 && (
              <span className="text-[10px] text-neutral-400 mt-1">Новый OEM — не найден в базе</span>
            )}
          </Field>
          <Field label="HEL Code" required hint="Артикул = RT + OEM (заполняется автоматически)">
            <div className="flex gap-2">
              <input value={data.helCode} onChange={e => u('helCode', e.target.value)} placeholder="RT9094702F58" className="font-mono" />
              <button onClick={auto} className="shrink-0 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-600 cursor-pointer font-medium transition-colors">
                Auto
              </button>
            </div>
          </Field>
          <Field label="Наименование" required>
            <select value={data.partName} onChange={e => u('partName', e.target.value)}>
              {PART_NAMES.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-5">
          <Field label="Расположение" required>
            <div className="flex gap-1.5 flex-wrap mt-1">
              {POS_OPTIONS.map(p => (
                <button key={p} onClick={() => u('position', p)}
                  className={cl(
                    'px-2.5 py-1 text-xs rounded-lg border cursor-pointer transition-all font-medium',
                    data.position === p
                      ? 'bg-[#ED1C24] border-[#ED1C24] text-white'
                      : 'bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700'
                  )}>
                  {p}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-5">
        <Card title="Применимость (авто)">
          <textarea value={data.applicability} onChange={e => u('applicability', e.target.value)}
            placeholder="AUDI A6 (4B2, C5) rear;left 1997-2005&#10;VW PASSAT (3B2) rear;left 1996-2001"
            rows={Math.max(3, (data.applicability || '').split('\n').length + 1)} className="w-full text-xs font-mono" />
          <QuickAddCar onAdd={(line) => u('applicability', ((data.applicability || '') + '\n' + line).trim())} />
        </Card>
        </div>
      </Card>

      <div className="space-y-5">
        <Card title="Кросс-референсы (замены OEM)">
          <div className="space-y-2">
            {data.crossRefs.map((ref, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-[11px] text-neutral-400 w-5 shrink-0 text-right font-mono">#{i + 1}</span>
                <input value={ref.oem} onChange={e => uCR(i, e.target.value)} placeholder="OEM номер замены" className="font-mono" />
                {data.crossRefs.length > 1 && (
                  <button onClick={() => rmCR(i)} className="p-1.5 hover:bg-red-50 rounded-lg text-[#ED1C24] cursor-pointer">
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            <Btn onClick={addCR} variant="ghost" size="sm"><Plus size={13} /> Добавить кросс</Btn>
          </div>
        </Card>

        <Card title="Аналоги (Dorman, TRW, ATE, Bosch, Masumo)">
          <div className="space-y-2">
            {data.analogs.map((a, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-[11px] text-neutral-400 w-5 shrink-0 text-right font-mono">#{i + 1}</span>
                <div className="flex-1 flex gap-2 min-w-0">
                  <select value={a.brand} onChange={e => uA(i, 'brand', e.target.value)} className="w-1/2 text-xs">
                    <option value="">Бренд</option>
                    {BRANDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                  <input value={a.code} onChange={e => uA(i, 'code', e.target.value)} placeholder="Артикул" className="w-1/2 font-mono text-xs" />
                </div>
                {data.analogs.length > 1 && (
                  <button onClick={() => rmA(i)} className="p-1.5 hover:bg-red-50 rounded-lg text-[#ED1C24] cursor-pointer">
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            <Btn onClick={addA} variant="ghost" size="sm"><Plus size={13} /> Добавить аналог</Btn>
          </div>
        </Card>
      </div>

      <Card title="Мета-информация">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="Источник кросса" hint="Exist, TecDoc, вручную">
            <input value={data.source} onChange={e => u('source', e.target.value)} placeholder="TecDoc" />
          </Field>
          <Field label="Надёжность">
            <select value={data.confidence} onChange={e => u('confidence', e.target.value)}>
              <option value="">—</option>
              <option value="100%">100% — Проверено</option>
              <option value="high">Высокая</option>
              <option value="needs_check">Требует проверки</option>
              <option value="low">Низкая</option>
            </select>
          </Field>
          <Field label="Примечание" hint="ABS, AMG и т.п.">
            <input value={data.comment} onChange={e => u('comment', e.target.value)} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ==================== STEP 2: SCHEME ====================
function PriceBadge({ amount }: { amount: number }) {
  if (!amount) return null
  return <span className="ml-1 text-[10px] font-mono text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">{fmtRub(amount)}</span>
}

function Step2Scheme({ data, onChange, catalogs, productMap, priceTier, onTierChange }: {
  data: SchemeData; onChange: (d: SchemeData) => void; catalogs: Catalogs
  productMap: Map<string, Product>; priceTier: PriceTier; onTierChange: (t: PriceTier) => void
}) {
  const u = (key: keyof SchemeData, val: SchemeData[keyof SchemeData]) => onChange({ ...data, [key]: val })
  const uLine = (li: number, key: keyof HoseLine, val: string) => {
    const lines = [...data.lines]; lines[li] = { ...lines[li], [key]: val }; u('lines', lines)
  }
  const addLine = () => u('lines', [...data.lines, emptyLine()])
  const rmLine = (i: number) => { if (data.lines.length > 1) u('lines', data.lines.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-5">
      {/* Price tier selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mr-1">Тип цены:</span>
        {PRICE_TIERS.map(t => (
          <button key={t.key} onClick={() => onTierChange(t.key)}
            className={cl(
              'px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all',
              priceTier === t.key
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-neutral-500 border-neutral-200 hover:border-green-400'
            )}>{t.label}</button>
        ))}
      </div>

      <Card title="Параметры схемы">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Field label="OEM номер">
            <input value={data.oemNumber} readOnly className="font-mono" />
          </Field>
          <Field label="Расположение" required>
            <select value={data.position} onChange={e => u('position', e.target.value)}>
              <option>FRONT</option><option>REAR</option><option>MIDDLE</option>
            </select>
          </Field>
          <Field label="Сторона" required>
            <select value={data.side} onChange={e => u('side', e.target.value)}>
              {SIDES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Общая длина (мм)">
            <input type="number" value={data.totalLength} onChange={e => u('totalLength', e.target.value)} placeholder="500" className="font-mono" />
          </Field>
          <Field label="Количество">
            <input type="number" value={data.quantity} onChange={e => u('quantity', e.target.value)} placeholder="1" className="font-mono" />
          </Field>
        </div>

        {/* Hose color selector */}
        <div className="mt-4 pt-4 border-t border-neutral-100">
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-2">Цвет шланга (H707)</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {HOSE_COLORS.map(c => (
              <button key={c.code} onClick={() => u('hoseColor', c.code)} title={c.code}
                className={cl(
                  'w-7 h-7 rounded-full border-2 cursor-pointer transition-all',
                  data.hoseColor === c.code ? 'border-[#ED1C24] scale-110 shadow-md' : 'border-neutral-300 hover:border-neutral-500'
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <span className="text-xs text-neutral-500 ml-2">{data.hoseColor}</span>
          </div>
        </div>
      </Card>

      {data.lines.map((line, i) => {
        const lp = calcLinePrice(line, data.hoseColor, productMap, priceTier)
        return (
        <div key={i} className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm">
          {/* Hose header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 bg-neutral-50">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#ED1C24] flex items-center justify-center text-[11px] font-black text-white">
                {i + 1}
              </div>
              <span className="text-sm font-bold text-neutral-700">Шланг #{i + 1}</span>
              {line.cut && (
                <span className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-semibold">
                  CUT {line.cut} мм
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {lp.total > 0 && (
                <span className="font-mono text-sm font-black text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-lg">
                  {fmtRub(Math.round(lp.total))}
                </span>
              )}
              {data.lines.length > 1 && (
                <Btn onClick={() => rmLine(i)} variant="danger" size="sm"><Trash2 size={12} /></Btn>
              )}
            </div>
          </div>

          <div className="p-5">
            {/* Visual hose diagram */}
            <HoseDiagram line={line} productMap={productMap} hoseColor={data.hoseColor}
              onSupportsChange={(s, f) => { const lines = [...data.lines]; lines[i] = { ...lines[i], supports: s, supportsFlipped: f }; onChange({ ...data, lines }) }} />

            {/* Form fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Fitting 1 */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold text-[#ED1C24] uppercase tracking-widest border-b border-red-100 pb-1.5">
                  Фитинг 1 (левый)
                </div>
                <Field label={<>Фитинг<PriceBadge amount={lp.fitting1} /></>} required>
                  <CatalogSelect value={line.fitting1} onChange={v => uLine(i, 'fitting1', v)} catalog={catalogs.fittings} placeholder="Выбрать фитинг" />
                </Field>
                <Field label="Доп. артикул">
                  <input value={line.fitting1_extra} onChange={e => uLine(i, 'fitting1_extra', e.target.value)} placeholder="KFC168..." className="font-mono text-xs" />
                </Field>
                <Field label={<>Вставка<PriceBadge amount={lp.insert1} /></>}>
                  <CatalogSelect value={line.insert1} onChange={v => uLine(i, 'insert1', v)} catalog={catalogs.inserts} placeholder="Нет вставки" />
                </Field>
                <Field label="Загиб / Угол">
                  <CatalogSelect value={line.bend1} onChange={v => uLine(i, 'bend1', v)} catalog={catalogs.angles} placeholder="Прямой" />
                </Field>
                <Field label="Ориентация загиба">
                  <CatalogSelect value={line.bend1_orient || ''} onChange={v => uLine(i, 'bend1_orient', v)} catalog={catalogs.bendOrients} placeholder="Не задана" />
                </Field>
                <Field label={<>Болт (Banjo) лев.<PriceBadge amount={lp.bolt1} /></>}>
                  <CatalogSelect value={line.bolt1} onChange={v => uLine(i, 'bolt1', v)} catalog={catalogs.bolts} placeholder="Нет болта" />
                </Field>
              </div>

              {/* Hose body */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest border-b border-neutral-100 pb-1.5">
                  Шланг / Крепления
                </div>
                <Field label={<>CUT длина (мм)<PriceBadge amount={lp.hose} /></>} required>
                  <input type="text" value={line.cut} onChange={e => uLine(i, 'cut', e.target.value)} placeholder="435" className="font-mono text-sm font-bold" />
                </Field>
                {(line.supports || []).map((sup, si) => (
                  <Field key={si} label={<>Крепление {si + 1}<PriceBadge amount={getPrice(productMap, sup, priceTier)} />{(line.supports || []).length > 1 && (
                    <button onClick={() => { const s = [...(line.supports || [])]; const f = [...(line.supportsFlipped || [])]; s.splice(si, 1); f.splice(si, 1); const lines = [...data.lines]; lines[i] = { ...lines[i], supports: s, supportsFlipped: f }; onChange({ ...data, lines }) }}
                      className="ml-1 text-[#ED1C24] hover:text-red-700 cursor-pointer"><X size={10} /></button>
                  )}</>}>
                    <CatalogSelect value={sup} onChange={v => { const s = [...(line.supports || [])]; s[si] = v; const lines = [...data.lines]; lines[i] = { ...lines[i], supports: s }; onChange({ ...data, lines }) }} catalog={catalogs.supports} placeholder="Выбрать" />
                  </Field>
                ))}
                <button onClick={() => { const s = [...(line.supports || []), '']; const f = [...(line.supportsFlipped || []), false]; const lines = [...data.lines]; lines[i] = { ...lines[i], supports: s, supportsFlipped: f }; onChange({ ...data, lines }) }}
                  className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center gap-1 mt-1">
                  <Plus size={12} /> Добавить крепление
                </button>
              </div>

              {/* Fitting 2 */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold text-[#ED1C24] uppercase tracking-widest border-b border-red-100 pb-1.5">
                  Фитинг 2 (правый)
                </div>
                <Field label={<>Фитинг<PriceBadge amount={lp.fitting2} /></>}>
                  <CatalogSelect value={line.fitting2} onChange={v => uLine(i, 'fitting2', v)} catalog={catalogs.fittings} placeholder="Выбрать фитинг" />
                </Field>
                <Field label="Доп. артикул">
                  <input value={line.fitting2_extra} onChange={e => uLine(i, 'fitting2_extra', e.target.value)} placeholder="" className="font-mono text-xs" />
                </Field>
                <Field label={<>Вставка 2<PriceBadge amount={getPrice(productMap, line.insert2, priceTier)} /></>}>
                  <CatalogSelect value={line.insert2} onChange={v => uLine(i, 'insert2', v)} catalog={catalogs.inserts} placeholder="Нет вставки" />
                </Field>
                <Field label="Загиб / Угол">
                  <CatalogSelect value={line.bend2} onChange={v => uLine(i, 'bend2', v)} catalog={catalogs.angles} placeholder="Прямой" />
                </Field>
                <Field label="Ориентация загиба">
                  <CatalogSelect value={line.bend2_orient || ''} onChange={v => uLine(i, 'bend2_orient', v)} catalog={catalogs.bendOrients} placeholder="Не задана" />
                </Field>
                <Field label={<>Болт (Banjo)<PriceBadge amount={lp.bolt} /></>}>
                  <CatalogSelect value={line.bolt} onChange={v => uLine(i, 'bolt', v)} catalog={catalogs.bolts} placeholder="Нет болта" />
                </Field>
              </div>
            </div>
          </div>
        </div>
        )
      })}

      {/* Grand total */}
      {data.lines.some(l => l.fitting1 || l.cut) && (() => {
        const grandTotal = data.lines.reduce((sum, l) => sum + calcLinePrice(l, data.hoseColor, productMap, priceTier).total, 0)
        const qty = parseInt(data.quantity) || 1
        return grandTotal > 0 ? (
          <div className="flex items-center justify-end gap-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3">
            <span className="text-xs font-bold text-green-700 uppercase tracking-widest">Итого{qty > 1 ? ` x${qty}` : ''}:</span>
            <span className="font-mono text-xl font-black text-green-800">{fmtRub(Math.round(grandTotal * qty))}</span>
          </div>
        ) : null
      })()}

      <Btn onClick={addLine} variant="secondary">
        <Plus size={16} /> Добавить шланг в схему
      </Btn>

      <Card title="Примечания">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Примечание RUS">
            <textarea value={data.noteRus} onChange={e => u('noteRus', e.target.value)}
              placeholder="HLL-010 Хвостом к H670" rows={2} />
          </Field>
          <Field label="Примечание ENG">
            <textarea value={data.noteEng} onChange={e => u('noteEng', e.target.value)} rows={2} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ==================== STEP 3: REVIEW ====================
function Step3Review({ oem, scheme, productMap, priceTier, onTierChange }: {
  oem: OemData; scheme: SchemeData; productMap: Map<string, Product>; priceTier: PriceTier; onTierChange: (t: PriceTier) => void
}) {
  return (
    <div className="space-y-5">
      <Card title="OEM данные">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 text-sm">
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">HEL Code</div>
            <div className="font-mono text-[#ED1C24] font-bold">{oem.helCode || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">OEM</div>
            <div className="font-mono text-neutral-900">{oem.oem || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Тип</div>
            <div className="text-neutral-700">{oem.partName}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Расположение</div>
            <Badge color="red">{oem.position || '—'}</Badge>
          </div>
        </div>

        {oem.crossRefs.some(c => c.oem) && (
          <div className="mt-4 pt-4 border-t border-neutral-100 text-xs">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mr-2">Кроссы:</span>
            {oem.crossRefs.filter(c => c.oem).map((c, i) => (
              <span key={i} className="font-mono text-amber-600 mr-3">{c.oem}</span>
            ))}
          </div>
        )}
        {oem.analogs.some(a => a.code) && (
          <div className="mt-3 pt-3 border-t border-neutral-100 text-xs flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide">Аналоги:</span>
            {oem.analogs.filter(a => a.code).map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Badge color="purple">{a.brand}</Badge>
                <span className="font-mono text-neutral-700">{a.code}</span>
              </span>
            ))}
          </div>
        )}
        {oem.applicability && (
          <div className="mt-3 pt-3 border-t border-neutral-100 text-xs text-neutral-600">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mr-2">Применимость:</span>
            {oem.applicability}
          </div>
        )}
      </Card>

      <Card title="Схема сборки">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mb-5">
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">OEM</div>
            <div className="font-mono text-neutral-700">{scheme.oemNumber}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Расположение</div>
            <div>{scheme.position}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Сторона</div>
            <div>{scheme.side}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Длина</div>
            <div className="font-mono text-[#ED1C24] font-bold">{scheme.totalLength || '—'} мм</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mb-1">Шлангов</div>
            <div>{scheme.lines.length}</div>
          </div>
        </div>

        {scheme.lines.map((line, i) => (
          <div key={i} className="mb-3">
            <HoseDiagram line={line} productMap={productMap} hoseColor={scheme.hoseColor} />
            <div className="grid grid-cols-3 md:grid-cols-6 gap-x-5 gap-y-1 text-xs px-1">
              {line.fitting1 && <div><span className="text-neutral-400">Ф1: </span><span className="font-mono text-[#ED1C24]">{line.fitting1}</span></div>}
              {line.insert1  && <div><span className="text-neutral-400">Вст: </span><span className="font-mono">{line.insert1}</span></div>}
              {line.bend1    && <div><span className="text-neutral-400">Угол1: </span><span className="font-mono">{line.bend1}</span></div>}
              {line.cut      && <div><span className="text-neutral-400">CUT: </span><span className="font-mono text-green-700 font-bold">{line.cut}</span></div>}
              {line.fitting2 && <div><span className="text-neutral-400">Ф2: </span><span className="font-mono text-[#ED1C24]">{line.fitting2}</span></div>}
              {line.bolt1    && <div><span className="text-neutral-400">Болт Л: </span><span className="font-mono">{line.bolt1}</span></div>}
              {line.bolt     && <div><span className="text-neutral-400">Болт П: </span><span className="font-mono">{line.bolt}</span></div>}
              {(line.supports || []).filter(Boolean).map((s, si) => (
                <div key={si}><span className="text-neutral-400">Креп {si+1}: </span><span className="font-mono text-amber-600">{s}</span></div>
              ))}
            </div>
          </div>
        ))}

        {scheme.noteRus && (
          <div className="mt-4 pt-4 border-t border-neutral-100 text-xs text-neutral-600">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wide mr-2">Примечание:</span>
            {scheme.noteRus}
          </div>
        )}
      </Card>

      {/* Price calculation */}
      <Card title="Калькуляция стоимости">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {PRICE_TIERS.map(t => (
            <button key={t.key} onClick={() => onTierChange(t.key)}
              className={cl(
                'px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all',
                priceTier === t.key
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-neutral-500 border-neutral-200 hover:border-green-400'
              )}>{t.label}</button>
          ))}
        </div>

        {scheme.lines.map((line, i) => {
          const lp = calcLinePrice(line, scheme.hoseColor, productMap, priceTier)
          const items: { label: string; sku: string; price: number }[] = []
          if (line.fitting1) items.push({ label: 'Фитинг 1', sku: line.fitting1, price: lp.fitting1 })
          if (line.insert1) items.push({ label: 'Вставка 1', sku: line.insert1, price: lp.insert1 })
          if (line.cut) items.push({ label: `Шланг H707 ${scheme.hoseColor} (${line.cut}мм)`, sku: 'H707', price: lp.hose })
          if (line.insert2) items.push({ label: 'Вставка 2', sku: line.insert2, price: lp.insert2 })
          if (line.fitting2) items.push({ label: 'Фитинг 2', sku: line.fitting2, price: lp.fitting2 })
          if (line.bolt1) items.push({ label: 'Болт лев.', sku: line.bolt1, price: lp.bolt1 })
          if (line.bolt) items.push({ label: 'Болт прав.', sku: line.bolt, price: lp.bolt })
          if (lp.supports > 0) {
            (line.supports || []).filter(Boolean).forEach((s, si) => {
              items.push({ label: `Крепление ${si + 1}`, sku: s, price: getPrice(productMap, s, priceTier) })
            })
          }
          items.push({ label: 'Гильзы H707-03C x2', sku: 'H707-03C', price: lp.sleeves })
          if (lp.washers > 0) items.push({ label: `Шайбы ${WASHER_SKU} x${lp.washerQty}`, sku: WASHER_SKU, price: lp.washers })
          return (
            <div key={i} className="mb-4">
              <div className="text-xs font-bold text-neutral-500 mb-2">Шланг #{i + 1}</div>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-neutral-200">
                  <th className="text-left py-1.5 text-[10px] font-bold text-neutral-400 uppercase">Компонент</th>
                  <th className="text-left py-1.5 text-[10px] font-bold text-neutral-400 uppercase">Артикул</th>
                  <th className="text-right py-1.5 text-[10px] font-bold text-neutral-400 uppercase">Цена</th>
                </tr></thead>
                <tbody>
                  {items.map((item, j) => (
                    <tr key={j} className="border-b border-neutral-50">
                      <td className="py-1.5 text-neutral-600">{item.label}</td>
                      <td className="py-1.5 font-mono text-[#ED1C24]">{item.sku}</td>
                      <td className="py-1.5 text-right font-mono font-semibold text-neutral-800">
                        {item.price > 0 ? fmtRub(Math.round(item.price)) : <span className="text-neutral-300">—</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-neutral-200">
                    <td colSpan={2} className="py-2 font-bold text-neutral-700">Итого линия #{i + 1}</td>
                    <td className="py-2 text-right font-mono font-black text-green-700">{fmtRub(Math.round(lp.total))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}

        {(() => {
          const grand = scheme.lines.reduce((s, l) => s + calcLinePrice(l, scheme.hoseColor, productMap, priceTier).total, 0)
          const qty = parseInt(scheme.quantity) || 1
          return grand > 0 ? (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-5 py-4 mt-2">
              <span className="text-sm font-bold text-green-800">ОБЩАЯ СТОИМОСТЬ{qty > 1 ? ` (x${qty} комплектов)` : ''}:</span>
              <span className="font-mono text-2xl font-black text-green-800">{fmtRub(Math.round(grand * qty))}</span>
            </div>
          ) : null
        })()}
      </Card>
    </div>
  )
}

// ==================== SIDEBAR RECORD LIST ====================
function RecordList({ records, activeId, onSelect, onDelete }: {
  records: SavedRecord[]; activeId: string | null
  onSelect: (r: SavedRecord) => void; onDelete: (id: string) => void
}) {
  if (!records.length) return (
    <div className="text-center text-neutral-400 text-xs py-8 px-3">
      <Database size={24} className="mx-auto mb-2 opacity-25" />
      <p>Нет записей</p>
    </div>
  )

  const sc = { draft: 'gray', step1: 'orange', complete: 'green' } as const
  const sl = { draft: 'Черновик', step1: 'Шаг 1', complete: 'Готово' } as const

  return (
    <div className="space-y-0.5 px-1">
      {records.map(r => (
        <div
          key={r.id}
          onClick={() => onSelect(r)}
          className={cl(
            'group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all',
            r.id === activeId
              ? 'bg-red-50 border border-[#ED1C24]/25'
              : 'hover:bg-neutral-100 border border-transparent'
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-neutral-800 truncate font-semibold">
              {r.oem.helCode || r.oem.oem || '—'}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge color={sc[r.status]}>{sl[r.status]}</Badge>
              <span className="text-[10px] text-neutral-400 truncate">{r.oem.position}</span>
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(r.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded text-[#ED1C24] cursor-pointer transition-opacity shrink-0 ml-1"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ==================== MAIN APP ====================
export default function App() {
  const [nav, setNav]                   = useState<'fill' | 'catalog' | 'fittings'>('catalog')
  const [step, setStep]                 = useState(0)
  const [oemData, setOemData]           = useState<OemData>(emptyOem())
  const [schemeData, setSchemeData]     = useState<SchemeData>(emptyScheme())
  const [records, setRecords]           = useState<SavedRecord[]>([])
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [toast, setToast]               = useState<string | null>(null)
  const [saving, setSaving]             = useState(false)
  const [loading, setLoading]           = useState(true)
  const [dbConnected, setDbConnected]   = useState(false)
  const [catalogs, setCatalogs]         = useState<Catalogs>(EMPTY_CATALOGS)
  const [products, setProducts]         = useState<Product[]>([])
  const [productMap, setProductMap]     = useState<Map<string, Product>>(new Map())
  const [priceTier, setPriceTier]       = useState<PriceTier>('price_dealer')

  const showToast = (msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    (async () => {
      try {
        const [recs, cats, prods] = await Promise.all([db.loadRecords(), db.loadCatalogs(), db.loadProducts()])
        setRecords(recs)
        const prodCats = buildProductCatalogs(prods)
        setCatalogs({ ...cats, ...prodCats })
        setProducts(prods)
        setProductMap(buildProductMap(prods))
        setDbConnected(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown'
        showToast('Ошибка загрузки: ' + msg)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const newRecord = () => {
    setOemData(emptyOem()); setSchemeData(emptyScheme()); setStep(0); setActiveRecordId(null)
  }

  const saveRecord = useCallback(async () => {
    setSaving(true)
    try {
      const id = activeRecordId || crypto.randomUUID()
      const rec: SavedRecord = {
        id, oem: oemData, scheme: step >= 1 ? schemeData : null,
        createdAt: new Date().toISOString(),
        status: step === 0 ? 'draft' : step === 1 ? 'step1' : 'complete'
      }
      await db.saveRecord(rec)
      const recs = await db.loadRecords()
      setRecords(recs)
      setActiveRecordId(id)
      showToast('Сохранено в базу')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      showToast('Ошибка сохранения: ' + msg)
    } finally {
      setSaving(false)
    }
  }, [activeRecordId, oemData, schemeData, step])

  const selectRecord = (r: SavedRecord) => {
    setOemData(r.oem)
    setSchemeData(r.scheme || emptyScheme(r.oem.oem))
    setActiveRecordId(r.id)
    setStep(r.status === 'complete' ? 2 : r.status === 'step1' ? 1 : 0)
  }

  const deleteRecord = async (id: string) => {
    try {
      await db.deleteRecord(id)
      setRecords(prev => prev.filter(r => r.id !== id))
      if (activeRecordId === id) newRecord()
      showToast('Удалено')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      showToast('Ошибка удаления: ' + msg)
    }
  }

  const goNext = async () => {
    if (step === 0) {
      if (!oemData.oem) { showToast('Укажите OEM номер'); return }
      setSchemeData(prev => ({ ...prev, oemNumber: oemData.oem }))
      await saveRecord()
    }
    if (step === 1) await saveRecord()
    setStep(s => Math.min(s + 1, 2))
  }


  return (
    <div className="min-h-screen flex bg-neutral-100 pb-14 md:pb-0">

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 flex z-50">
        {[
          { id: 'catalog' as const, icon: BookOpen, label: 'Каталог' },
          { id: 'fittings' as const, icon: Wrench, label: 'Фитинги' },
          { id: 'fill' as const, icon: Plus, label: 'Добавить' },
        ].map(item => (
          <button key={item.id} onClick={() => setNav(item.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer transition-all ${
              nav === item.id ? 'text-[#ED1C24]' : 'text-neutral-400'
            }`}>
            <item.icon size={18} />
            <span className="text-[10px] font-semibold">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex bg-white border-r border-neutral-200 flex-col shrink-0 w-56">

        {/* Logo */}
        <div className="border-b border-neutral-200 p-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ED1C24] flex items-center justify-center font-black text-sm text-white tracking-tight shrink-0">
              H
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-neutral-900 tracking-tight">HEL Baza</div>
              <div className="text-[10px] text-neutral-400 uppercase tracking-widest">PIM</div>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-2.5 text-[10px]">
            {dbConnected ? (
              <><Cloud size={10} className="text-green-600 shrink-0" />
              <span className="text-green-600">Supabase · {products.length} поз.</span></>
            ) : (
              <><CloudOff size={10} className="text-red-500 shrink-0" />
              <span className="text-red-500">Offline</span></>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-1.5 border-b border-neutral-200">
          {[
            { id: 'catalog'   as const, icon: BookOpen,  label: 'Каталог'    },
            { id: 'fittings'  as const, icon: Wrench,    label: 'Фитинги'   },
            { id: 'fill'      as const, icon: Plus,      label: 'Добавить'  },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setNav(item.id)}
              title={item.label}
              className={cl(
                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition-all',
                nav === item.id
                  ? 'bg-red-50 text-[#ED1C24] font-semibold'
                  : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'
              )}
            >
              <item.icon size={15} className="shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Records list (only in non-catalog mode) */}
        {nav === 'fill' && (
          <>
            <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
              <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest">
                Записи ({records.length})
              </span>
              <button onClick={newRecord} className="p-1 hover:bg-neutral-100 rounded text-neutral-400 cursor-pointer">
                <Plus size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-neutral-300" />
                </div>
              ) : (
                <RecordList records={records} activeId={activeRecordId} onSelect={selectRecord} onDelete={deleteRecord} />
              )}
            </div>
            <div className="p-2 border-t border-neutral-200">
              <Btn onClick={() => showToast('Excel импорт — в разработке')} variant="ghost" size="sm" className="w-full justify-center text-neutral-400">
                <FileSpreadsheet size={13} /> Импорт
              </Btn>
            </div>
          </>
        )}
      </aside>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {nav === 'fittings' ? (
          <>
            <header className="h-11 border-b border-neutral-200 flex items-center px-5 bg-white shrink-0 gap-3">
              <Wrench size={14} className="text-[#ED1C24] shrink-0" />
              <span className="font-semibold text-sm text-neutral-700">Каталог фитингов HEL</span>
              <span className="text-xs text-neutral-400">{products.length} позиций</span>
            </header>
            <FittingsCatalog />
          </>
        ) : nav === 'catalog' ? (
          <>
            <header className="h-11 border-b border-neutral-200 flex items-center px-5 bg-white shrink-0 gap-3">
              <BookOpen size={14} className="text-[#ED1C24] shrink-0" />
              <span className="font-semibold text-sm text-neutral-700">Каталог шлангов</span>
              <span className="text-xs text-neutral-400">TRW · DORMAN · BOSCH · ATE</span>
            </header>
            <BrakelineCatalog />
          </>
        ) : (
          <>
            {/* Fill header */}
            <header className="h-11 border-b border-neutral-200 flex items-center justify-between px-5 bg-white shrink-0">
              <div className="flex items-center gap-2.5">
                <Wrench size={14} className="text-neutral-400" />
                <span className="font-semibold text-sm text-neutral-700 font-mono">
                  {activeRecordId ? (oemData.helCode || oemData.oem || 'Запись') : 'Новая запись'}
                </span>
                {activeRecordId && (
                  <Badge color={step === 2 ? 'green' : step === 1 ? 'orange' : 'gray'}>
                    {step === 2 ? 'Готово' : step === 1 ? 'Шаг 1' : 'Черновик'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {activeRecordId && (
                  <Btn
                    onClick={() => {
                      setOemData({ ...oemData, helCode: '', oem: '' })
                      setSchemeData(emptyScheme())
                      setActiveRecordId(null)
                      setStep(0)
                      showToast('Шаблон скопирован')
                    }}
                    variant="ghost" size="sm"
                  >
                    <Copy size={12} />
                  </Btn>
                )}
                <Btn onClick={newRecord} variant="secondary" size="sm"><Plus size={12} /></Btn>
                <Btn onClick={saveRecord} variant="primary" size="sm" disabled={saving}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Сохранить
                </Btn>
              </div>
            </header>

            {/* Fill content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-4xl mx-auto px-6 py-6">
                <StepIndicator current={step} steps={['OEM данные', 'Схема', 'Проверка']} />

                {step === 0 && <Step1Oem data={oemData} onChange={setOemData} />}
                {step === 1 && <Step2Scheme data={schemeData} onChange={setSchemeData} catalogs={catalogs} productMap={productMap} priceTier={priceTier} onTierChange={setPriceTier} />}
                {step === 2 && <Step3Review oem={oemData} scheme={schemeData} productMap={productMap} priceTier={priceTier} onTierChange={setPriceTier} />}

                {/* Navigation buttons */}
                <div className="flex justify-between mt-8 pb-8">
                  <Btn onClick={() => setStep(s => Math.max(s - 1, 0))} variant="secondary" disabled={step === 0}>
                    <ChevronLeft size={15} /> Назад
                  </Btn>
                  {step < 2 ? (
                    <Btn onClick={goNext} variant="primary" disabled={saving}>
                      {saving && <Loader2 size={12} className="animate-spin" />}
                      {step === 0 ? 'К схеме' : 'Проверка'}
                      <ChevronRight size={15} />
                    </Btn>
                  ) : (
                    <Btn onClick={async () => { await saveRecord(); showToast('Сохранено') }} variant="success" disabled={saving}>
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={15} />}
                      В базу
                    </Btn>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 bg-white border border-neutral-200 rounded-xl px-4 py-3 shadow-xl flex items-center gap-2.5 text-sm z-50">
          <AlertCircle size={14} className="text-[#ED1C24] shrink-0" />
          {toast}
        </div>
      )}
    </div>
  )
}
