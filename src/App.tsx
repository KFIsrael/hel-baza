import { useState, useCallback, useEffect } from 'react'
import { supabase } from './supabase'
import { Database, Wrench, Search, BarChart3, Plus, ChevronRight, ChevronLeft, Save, X, Check, AlertCircle, Copy, Trash2, FileSpreadsheet, Loader2, Cloud, CloudOff } from 'lucide-react'

// ==================== TYPES ====================
interface Analog { brand: string; code: string }
interface CrossRef { oem: string }
interface OemData {
  helCode: string; partName: string; position: string; oem: string
  crossRefs: CrossRef[]; analogs: Analog[]
  source: string; confidence: string; comment: string; applicability: string
}
interface HoseLine {
  fitting1: string; fitting1_extra: string; insert1: string; bend1: string; cut: string
  support1: string; support2: string; support3: string
  fitting2: string; fitting2_extra: string; insert2: string; bend2: string; bolt: string
}
interface SchemeData {
  oemNumber: string; position: string; side: string; totalLength: string
  lines: HoseLine[]; quantity: string; alignment: string; noteRus: string; noteEng: string
}
interface SavedRecord {
  id: string; oem: OemData; scheme: SchemeData | null; createdAt: string
  status: 'draft' | 'step1' | 'complete'
}

// ==================== CONSTANTS ====================
const SIDES = ['LEFT', 'RIGHT', 'LEFT/RIGHT', 'LEFT(Drum)', 'RIGHT(Drum)', 'LEFT(Disc)', 'RIGHT(Disc)']
const BRANDS = ['ATE', 'Bosch', 'Dorman', 'TRW', 'Masumo', 'HEL', 'ÐÑÑÐ³Ð¾Ð¹']
const PART_NAMES = ['Ð¢Ð¾ÑÐ¼Ð¾Ð·Ð½Ð¾Ð¹ ÑÐ»Ð°Ð½Ð³', 'Ð¨Ð»Ð°Ð½Ð³ ÑÑÐµÐ¿Ð»ÐµÐ½Ð¸Ñ', 'Ð¢Ð¾ÑÐ¼Ð¾Ð·Ð½Ð°Ñ ÑÑÑÐ±ÐºÐ°']

// Catalogs loaded from Supabase (see useCatalogs hook)
type CatalogItem = { code: string; desc: string }
interface Catalogs {
  fittings: CatalogItem[]
  angles: CatalogItem[]
}
const EMPTY_CATALOGS: Catalogs = { fittings: [], angles: [] }

// Static catalogs (not in DB yet)
const INSERT_CATALOG: CatalogItem[] = [
  { code: 'H616', desc: 'Ð¡ÑÐ°Ð½Ð´Ð°ÑÑÐ½Ð°Ñ Ð²ÑÑÐ°Ð²ÐºÐ°' },
  { code: 'HSHORT', desc: 'ÐÐ¾ÑÐ¾ÑÐºÐ°Ñ Ð²ÑÑÐ°Ð²ÐºÐ°' },
  { code: 'HMEDIUM', desc: 'Ð¡ÑÐµÐ´Ð½ÑÑ Ð²ÑÑÐ°Ð²ÐºÐ°' },
  { code: 'HLONG', desc: 'ÐÐ»Ð¸Ð½Ð½Ð°Ñ Ð²ÑÑÐ°Ð²ÐºÐ°' },
]
const SUPPORT_CATALOG: CatalogItem[] = [
  { code: 'HLL-003', desc: 'ÐÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ ÑÑÐ°Ð½Ð´Ð°ÑÑ' },
  { code: 'HLL-010', desc: 'ÐÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ ÑÐ´Ð»Ð¸Ð½ÑÐ½Ð½Ð¾Ðµ' },
  { code: 'PLT-SUB-S14', desc: 'ÐÐ»Ð°ÑÑÐ¸Ð½Ð° Subaru' },
  { code: 'RIOBKT', desc: 'ÐÑÐ¾Ð½ÑÑÐµÐ¹Ð½ RIO' },
  { code: 'KFR-103-3', desc: 'ÐÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ (ÐÐ¸ÑÐ°Ð¹)' },
  { code: 'KFC168', desc: 'Ð¤Ð»Ð°Ð½ÐµÑ (ÐÐ¸ÑÐ°Ð¹)' },
]
const BOLT_CATALOG: CatalogItem[] = [
  { code: 'H160-31C', desc: 'Banjo Ð±Ð¾Ð»Ñ M10Ã1' },
  { code: 'H160-31CN', desc: 'Banjo Ð±Ð¾Ð»Ñ M10Ã1 (Ð½Ð¸ÐºÐµÐ»Ñ)' },
]

const emptyOem = (): OemData => ({
  helCode: '', partName: 'Ð¢Ð¾ÑÐ¼Ð¾Ð·Ð½Ð¾Ð¹ ÑÐ»Ð°Ð½Ð³', position: 'FRONT/LEFT/RIGHT',
  oem: '', crossRefs: [{ oem: '' }], analogs: [{ brand: '', code: '' }],
  source: '', confidence: '', comment: '', applicability: ''
})
const emptyLine = (): HoseLine => ({
  fitting1: '', fitting1_extra: '', insert1: '', bend1: '', cut: '',
  support1: '', support2: '', support3: '',
  fitting2: '', fitting2_extra: '', insert2: '', bend2: '', bolt: ''
})
const emptyScheme = (oem = ''): SchemeData => ({
  oemNumber: oem, position: 'FRONT', side: 'LEFT/RIGHT', totalLength: '',
  lines: [emptyLine()], quantity: '', alignment: '', noteRus: '', noteEng: ''
})

// ==================== SUPABASE DATA LAYER ====================
const db = {
  async loadRecords(): Promise<SavedRecord[]> {
    const { data, error } = await supabase
      .from('pim_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return (data || []).map(r => ({
      id: r.id,
      oem: r.oem_data as OemData,
      scheme: r.scheme_data as SchemeData | null,
      createdAt: r.created_at,
      status: r.status as 'draft' | 'step1' | 'complete',
    }))
  },

  async saveRecord(record: SavedRecord): Promise<string> {
    const row = {
      id: record.id,
      status: record.status,
      oem_data: record.oem,
      scheme_data: record.scheme,
      hel_code: record.oem.helCode || null,
      oem_number: record.oem.oem || null,
      position: record.oem.position || null,
    }
    const { data, error } = await supabase
      .from('pim_records')
      .upsert(row, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  },

  async deleteRecord(id: string): Promise<void> {
    const { error } = await supabase
      .from('pim_records')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  async loadCatalogs(): Promise<Catalogs> {
    const [fittingsRes, categoriesRes, anglesRes] = await Promise.all([
      supabase
        .from('fittings')
        .select('sku, name, size, category_id')
        .eq('is_active', true)
        .order('sku'),
      supabase
        .from('fitting_categories')
        .select('id, name'),
      supabase
        .from('fitting_angles')
        .select('name, degrees')
        .order('sort_order'),
    ])
    if (fittingsRes.error) throw new Error(fittingsRes.error.message)
    if (categoriesRes.error) throw new Error(categoriesRes.error.message)
    if (anglesRes.error) throw new Error(anglesRes.error.message)

    const catMap = new Map((categoriesRes.data || []).map((c: any) => [c.id, c.name]))

    const fittings: CatalogItem[] = (fittingsRes.data || []).map((f: any) => ({
      code: f.sku,
      desc: `${catMap.get(f.category_id) || ''} ${f.size || ''}`.trim() || f.name,
    }))

    const angles: CatalogItem[] = [
      { code: '', desc: 'â' },
      ...(anglesRes.data || []).map((a: any) => ({
        code: a.name,
        desc: `${a.name}${a.degrees ? ` (${a.degrees}Â°)` : ''}`,
      })),
    ]

    return { fittings, angles }
  },
}

// ==================== UI PRIMITIVES ====================
const cl = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ')

function Badge({ children, color = 'red' }: { children: React.ReactNode; color?: string }) {
  const c: Record<string, string> = {
    red: 'bg-red-50 text-[#ED1C24] border border-red-200',
    blue: 'bg-blue-50 text-blue-700 border border-blue-200',
    green: 'bg-green-50 text-green-700 border border-green-200',
    orange: 'bg-amber-50 text-amber-700 border border-amber-200',
    gray: 'bg-neutral-100 text-neutral-600 border border-neutral-200',
    purple: 'bg-purple-50 text-purple-700 border border-purple-200',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c[color] || c.red}`}>{children}</span>
}

function Btn({ children, onClick, variant = 'primary', size = 'md', disabled = false, className = '' }: {
  children: React.ReactNode; onClick?: () => void; variant?: string; size?: string; disabled?: boolean; className?: string
}) {
  const base = 'inline-flex items-center gap-2 font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
  const sz: Record<string, string> = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  const v: Record<string, string> = {
    primary: 'bg-[#ED1C24] hover:bg-[#d41920] text-white shadow-sm',
    secondary: 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 shadow-sm',
    blue: 'bg-[#ED1C24] hover:bg-[#d41920] text-white shadow-sm',
    danger: 'bg-red-50 hover:bg-red-100 text-[#ED1C24] border border-red-200',
    success: 'bg-green-600 hover:bg-green-700 text-white shadow-sm',
    ghost: 'hover:bg-neutral-100 text-neutral-500',
  }
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz[size]} ${v[variant]} ${className}`}>{children}</button>
}

function Field({ label, children, required = false, hint = '' }: {
  label: string; children: React.ReactNode; required?: boolean; hint?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-500">
        {label}{required && <span className="text-[#ED1C24] ml-0.5">*</span>}
      </label>
      {children}
      {hint && <span className="text-[11px] text-neutral-400">{hint}</span>}
    </div>
  )
}

function Card({ children, title, className = '' }: { children: React.ReactNode; title?: string; className?: string }) {
  return (
    <div className={`bg-white border border-neutral-200 rounded-lg p-5 shadow-sm ${className}`}>
      {title && <h3 className="text-xs font-semibold text-neutral-400 mb-4 uppercase tracking-widest">{title}</h3>}
      {children}
    </div>
  )
}

function CatalogSelect({ value, onChange, catalog, placeholder }: {
  value: string; onChange: (v: string) => void; catalog: { code: string; desc: string }[]; placeholder: string
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="font-mono text-xs">
      <option value="">{placeholder}</option>
      {catalog.map(c => <option key={c.code} value={c.code}>{c.code} â {c.desc}</option>)}
    </select>
  )
}

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cl(
            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
            i < current && 'bg-green-600 text-white',
            i === current && 'bg-[#ED1C24] text-white ring-2 ring-red-200',
            i > current && 'bg-neutral-200 text-neutral-400',
          )}>
            {i < current ? <Check size={13} /> : i + 1}
          </div>
          <span className={cl('text-sm', i === current ? 'text-neutral-900 font-medium' : 'text-neutral-400')}>{s}</span>
          {i < steps.length - 1 && <div className="w-6 h-px bg-neutral-300 mx-1" />}
        </div>
      ))}
    </div>
  )
}

// ==================== STEP 1: OEM ====================
function Step1Oem({ data, onChange }: { data: OemData; onChange: (d: OemData) => void }) {
  const u = (key: keyof OemData, val: any) => onChange({ ...data, [key]: val })
  const addCR = () => u('crossRefs', [...data.crossRefs, { oem: '' }])
  const rmCR = (i: number) => u('crossRefs', data.crossRefs.filter((_, idx) => idx !== i))
  const uCR = (i: number, val: string) => { const r = [...data.crossRefs]; r[i] = { oem: val }; u('crossRefs', r) }
  const addA = () => u('analogs', [...data.analogs, { brand: '', code: '' }])
  const rmA = (i: number) => u('analogs', data.analogs.filter((_, idx) => idx !== i))
  const uA = (i: number, k: keyof Analog, v: string) => { const a = [...data.analogs]; a[i] = { ...a[i], [k]: v }; u('analogs', a) }
  const auto = () => { if (data.oem) u('helCode', 'RT' + data.oem.replace(/[^a-zA-Z0-9]/g, '')) }

  const POS_OPTIONS = [
    'FRONT/LEFT/RIGHT', 'FRONT LEFT', 'FRONT RIGHT',
    'REAR LEFT', 'REAR RIGHT', 'REAR LEFT/RIGHT',
    'REAR LEFT(Drum)', 'REAR RIGHT(Drum)', 'REAR LEFT(Disc)', 'REAR RIGHT(Disc)',
  ]

  return (
    <div className="space-y-5">
      <Card title="ÐÑÐ½Ð¾Ð²Ð½Ð°Ñ Ð¸Ð½ÑÐ¾ÑÐ¼Ð°ÑÐ¸Ñ">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="OEM Ð½Ð¾Ð¼ÐµÑ" required hint="ÐÑÐ¸Ð³Ð¸Ð½Ð°Ð»ÑÐ½ÑÐ¹ Ð½Ð¾Ð¼ÐµÑ Ð¿ÑÐ¾Ð¸Ð·Ð²Ð¾Ð´Ð¸ÑÐµÐ»Ñ">
            <input value={data.oem} onChange={e => u('oem', e.target.value)} placeholder="9094702F58" className="font-mono" />
          </Field>
          <Field label="HEL Code" required hint="Ð£Ð½Ð¸ÐºÐ°Ð»ÑÐ½ÑÐ¹ ID (RT + OEM)">
            <div className="flex gap-2">
              <input value={data.helCode} onChange={e => u('helCode', e.target.value)} placeholder="RT9094702F58" className="font-mono" />
              <button onClick={auto} className="shrink-0 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded-lg text-xs text-neutral-600 cursor-pointer transition-colors">Auto</button>
            </div>
          </Field>
          <Field label="ÐÐ°Ð¸Ð¼ÐµÐ½Ð¾Ð²Ð°Ð½Ð¸Ðµ" required>
            <select value={data.partName} onChange={e => u('partName', e.target.value)}>
              {PART_NAMES.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field label="Ð Ð°ÑÐ¿Ð¾Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ" required>
            <div className="flex gap-1.5 flex-wrap">
              {POS_OPTIONS.map(p => (
                <button key={p} onClick={() => u('position', p)}
                  className={cl('px-2.5 py-1 text-xs rounded-lg border cursor-pointer transition-all',
                    data.position === p ? 'bg-red-50 border-[#ED1C24] text-[#ED1C24] font-semibold' : 'bg-white border-neutral-300 text-neutral-500 hover:border-neutral-400')}>
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ÐÑÐ¸Ð¼ÐµÐ½Ð¸Ð¼Ð¾ÑÑÑ" hint="ÐÐ°ÑÐºÐ°, Ð¼Ð¾Ð´ÐµÐ»Ñ, Ð³Ð¾Ð´">
            <textarea value={data.applicability} onChange={e => u('applicability', e.target.value)}
              placeholder="Toyota Corolla 2019-2024" rows={2} />
          </Field>
        </div>
      </Card>

      <Card title="ÐÑÐ¾ÑÑ-ÑÐµÑÐµÑÐµÐ½ÑÑ (Ð·Ð°Ð¼ÐµÐ½Ñ OEM)">
        <div className="space-y-2">
          {data.crossRefs.map((ref, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-[11px] text-neutral-400 w-5 shrink-0 text-right">#{i + 1}</span>
              <input value={ref.oem} onChange={e => uCR(i, e.target.value)} placeholder="OEM Ð½Ð¾Ð¼ÐµÑ Ð·Ð°Ð¼ÐµÐ½Ñ" className="font-mono" />
              {data.crossRefs.length > 1 && (
                <button onClick={() => rmCR(i)} className="p-1 hover:bg-red-50 rounded text-[#ED1C24] cursor-pointer"><X size={14} /></button>
              )}
            </div>
          ))}
          <Btn onClick={addCR} variant="ghost" size="sm"><Plus size={14} /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÐºÑÐ¾ÑÑ</Btn>
        </div>
      </Card>

      <Card title="ÐÐ½Ð°Ð»Ð¾Ð³Ð¸ (Dorman, TRW, ATE, Bosch, Masumo)">
        <div className="space-y-2">
          {data.analogs.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="text-[11px] text-neutral-400 w-5 shrink-0 text-right">#{i + 1}</span>
              <select value={a.brand} onChange={e => uA(i, 'brand', e.target.value)} className="w-36 shrink-0">
                <option value="">ÐÑÐ¾Ð¸Ð·Ð²Ð¾Ð´Ð¸ÑÐµÐ»Ñ</option>
                {BRANDS.map(b => <option key={b}>{b}</option>)}
              </select>
              <input value={a.code} onChange={e => uA(i, 'code', e.target.value)} placeholder="ÐÑÑÐ¸ÐºÑÐ»" className="font-mono" />
              {data.analogs.length > 1 && (
                <button onClick={() => rmA(i)} className="p-1 hover:bg-red-50 rounded text-[#ED1C24] cursor-pointer"><X size={14} /></button>
              )}
            </div>
          ))}
          <Btn onClick={addA} variant="ghost" size="sm"><Plus size={14} /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ Ð°Ð½Ð°Ð»Ð¾Ð³</Btn>
        </div>
      </Card>

      <Card title="ÐÐµÑÐ°-Ð¸Ð½ÑÐ¾ÑÐ¼Ð°ÑÐ¸Ñ">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="ÐÑÑÐ¾ÑÐ½Ð¸Ðº ÐºÑÐ¾ÑÑÐ°" hint="Exist, TecDoc, Ð²ÑÑÑÐ½ÑÑ">
            <input value={data.source} onChange={e => u('source', e.target.value)} placeholder="TecDoc" />
          </Field>
          <Field label="ÐÐ°Ð´ÑÐ¶Ð½Ð¾ÑÑÑ">
            <select value={data.confidence} onChange={e => u('confidence', e.target.value)}>
              <option value="">â</option>
              <option value="100%">100% â ÐÑÐ¾Ð²ÐµÑÐµÐ½Ð¾</option>
              <option value="high">ÐÑÑÐ¾ÐºÐ°Ñ</option>
              <option value="needs_check">Ð¢ÑÐµÐ±ÑÐµÑ Ð¿ÑÐ¾Ð²ÐµÑÐºÐ¸</option>
              <option value="low">ÐÐ¸Ð·ÐºÐ°Ñ</option>
            </select>
          </Field>
          <Field label="ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ðµ" hint="ABS, AMG Ð¸ Ñ.Ð¿.">
            <input value={data.comment} onChange={e => u('comment', e.target.value)} placeholder="" />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ==================== STEP 2: SCHEME ====================
function Step2Scheme({ data, onChange, catalogs }: { data: SchemeData; onChange: (d: SchemeData) => void; catalogs: Catalogs }) {
  const u = (key: keyof SchemeData, val: any) => onChange({ ...data, [key]: val })
  const uLine = (li: number, key: keyof HoseLine, val: string) => {
    const lines = [...data.lines]; lines[li] = { ...lines[li], [key]: val }; u('lines', lines)
  }
  const addLine = () => u('lines', [...data.lines, emptyLine()])
  const rmLine = (i: number) => { if (data.lines.length > 1) u('lines', data.lines.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-5">
      <Card title="ÐÐ°ÑÐ°Ð¼ÐµÑÑÑ ÑÑÐµÐ¼Ñ">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Field label="OEM Ð½Ð¾Ð¼ÐµÑ">
            <input value={data.oemNumber} readOnly className="font-mono" />
          </Field>
          <Field label="Ð Ð°ÑÐ¿Ð¾Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ" required>
            <select value={data.position} onChange={e => u('position', e.target.value)}>
              <option>FRONT</option><option>REAR</option><option>MIDDLE</option>
            </select>
          </Field>
          <Field label="Ð¡ÑÐ¾ÑÐ¾Ð½Ð°" required>
            <select value={data.side} onChange={e => u('side', e.target.value)}>
              {SIDES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="ÐÐ±ÑÐ°Ñ Ð´Ð»Ð¸Ð½Ð° (Ð¼Ð¼)" required>
            <input type="number" value={data.totalLength} onChange={e => u('totalLength', e.target.value)} placeholder="500" className="font-mono" />
          </Field>
          <Field label="ÐÐ¾Ð»Ð¸ÑÐµÑÑÐ²Ð¾">
            <input type="number" value={data.quantity} onChange={e => u('quantity', e.target.value)} placeholder="1" className="font-mono" />
          </Field>
        </div>
      </Card>

      {data.lines.map((line, i) => (
        <Card key={i} className="relative border-l-4 border-l-[#ED1C24]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#ED1C24] flex items-center justify-center text-[11px] font-bold text-white">{i + 1}</div>
              <span className="text-sm font-semibold text-neutral-700">Ð¨Ð»Ð°Ð½Ð³ #{i + 1}</span>
            </div>
            {data.lines.length > 1 && (
              <Btn onClick={() => rmLine(i)} variant="danger" size="sm"><Trash2 size={12} /></Btn>
            )}
          </div>

          <div className="mb-4 pb-4 border-b border-neutral-100">
            <div className="text-[11px] text-[#ED1C24] font-semibold uppercase tracking-widest mb-2">Ð¤Ð¸ÑÐ¸Ð½Ð³ 1 (Ð»ÐµÐ²ÑÐ¹)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Ð¤Ð¸ÑÐ¸Ð½Ð³" required>
                <CatalogSelect value={line.fitting1} onChange={v => uLine(i, 'fitting1', v)} catalog={catalogs.fittings} placeholder="ÐÑÐ±ÑÐ°ÑÑ ÑÐ¸ÑÐ¸Ð½Ð³" />
              </Field>
              <Field label="ÐÐ¾Ð¿. Ð°ÑÑÐ¸ÐºÑÐ»" hint="ÐÑÐ»Ð¸ ÐµÑÑÑ">
                <input value={line.fitting1_extra} onChange={e => uLine(i, 'fitting1_extra', e.target.value)} placeholder="KFC168..." className="font-mono text-xs" />
              </Field>
              <Field label="ÐÑÑÐ°Ð²ÐºÐ°">
                <CatalogSelect value={line.insert1} onChange={v => uLine(i, 'insert1', v)} catalog={INSERT_CATALOG} placeholder="ÐÑÐ±ÑÐ°ÑÑ Ð²ÑÑÐ°Ð²ÐºÑ" />
              </Field>
              <Field label="ÐÐ°Ð³Ð¸Ð± / Ð£Ð³Ð¾Ð»">
                <CatalogSelect value={line.bend1} onChange={v => uLine(i, 'bend1', v)} catalog={catalogs.angles} placeholder="â" />
              </Field>
            </div>
          </div>

          <div className="mb-4 pb-4 border-b border-neutral-100">
            <div className="text-[11px] text-neutral-500 font-semibold uppercase tracking-widest mb-2">Ð¨Ð»Ð°Ð½Ð³</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="CUT Ð´Ð»Ð¸Ð½Ð° (Ð¼Ð¼)" required>
                <input type="text" value={line.cut} onChange={e => uLine(i, 'cut', e.target.value)} placeholder="435" className="font-mono text-xs" />
              </Field>
              <Field label="ÐÑÐµÐ¿ 1">
                <CatalogSelect value={line.support1} onChange={v => uLine(i, 'support1', v)} catalog={SUPPORT_CATALOG} placeholder="ÐÑÐ±ÑÐ°ÑÑ" />
              </Field>
              <Field label="ÐÑÐµÐ¿ 2">
                <CatalogSelect value={line.support2} onChange={v => uLine(i, 'support2', v)} catalog={SUPPORT_CATALOG} placeholder="â" />
              </Field>
              <Field label="ÐÑÐµÐ¿ 3">
                <CatalogSelect value={line.support3} onChange={v => uLine(i, 'support3', v)} catalog={SUPPORT_CATALOG} placeholder="â" />
              </Field>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#ED1C24] font-semibold uppercase tracking-widest mb-2">Ð¤Ð¸ÑÐ¸Ð½Ð³ 2 (Ð¿ÑÐ°Ð²ÑÐ¹)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Ð¤Ð¸ÑÐ¸Ð½Ð³">
                <CatalogSelect value={line.fitting2} onChange={v => uLine(i, 'fitting2', v)} catalog={catalogs.fittings} placeholder="ÐÑÐ±ÑÐ°ÑÑ ÑÐ¸ÑÐ¸Ð½Ð³" />
              </Field>
              <Field label="ÐÐ¾Ð¿. Ð°ÑÑÐ¸ÐºÑÐ»">
                <input value={line.fitting2_extra} onChange={e => uLine(i, 'fitting2_extra', e.target.value)} placeholder="" className="font-mono text-xs" />
              </Field>
              <Field label="ÐÐ°Ð³Ð¸Ð± / Ð£Ð³Ð¾Ð»">
                <CatalogSelect value={line.bend2} onChange={v => uLine(i, 'bend2', v)} catalog={catalogs.angles} placeholder="â" />
              </Field>
              <Field label="ÐÐ¾Ð»Ñ">
                <CatalogSelect value={line.bolt} onChange={v => uLine(i, 'bolt', v)} catalog={BOLT_CATALOG} placeholder="ÐÑÐ±ÑÐ°ÑÑ Ð±Ð¾Ð»Ñ" />
              </Field>
            </div>
          </div>
        </Card>
      ))}

      <Btn onClick={addLine} variant="secondary"><Plus size={16} /> ÐÐ¾Ð±Ð°Ð²Ð¸ÑÑ ÑÐ»Ð°Ð½Ð³ Ð² ÑÑÐµÐ¼Ñ</Btn>

      <Card title="ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ñ">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ðµ RUS">
            <textarea value={data.noteRus} onChange={e => u('noteRus', e.target.value)} placeholder="HLL-010 Ð¥Ð²Ð¾ÑÑÐ¾Ð¼ Ðº H670" rows={2} />
          </Field>
          <Field label="ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ðµ ENG">
            <textarea value={data.noteEng} onChange={e => u('noteEng', e.target.value)} placeholder="" rows={2} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ==================== STEP 3: REVIEW ====================
function Step3Review({ oem, scheme }: { oem: OemData; scheme: SchemeData }) {
  return (
    <div className="space-y-5">
      <Card title="OEM Ð´Ð°Ð½Ð½ÑÐµ">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-neutral-400 text-xs">HEL Code</span><br /><span className="font-mono text-[#ED1C24] font-semibold">{oem.helCode || 'â'}</span></div>
          <div><span className="text-neutral-400 text-xs">OEM</span><br /><span className="font-mono text-neutral-900">{oem.oem || 'â'}</span></div>
          <div><span className="text-neutral-400 text-xs">Ð¢Ð¸Ð¿</span><br />{oem.partName}</div>
          <div><span className="text-neutral-400 text-xs">Ð Ð°ÑÐ¿Ð¾Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ</span><br /><Badge color="red">{oem.position || 'â'}</Badge></div>
        </div>
        {oem.crossRefs.some(c => c.oem) && (
          <div className="mt-3 pt-3 border-t border-neutral-100 text-xs">
            <span className="text-neutral-400">ÐÑÐ¾ÑÑÑ: </span>
            {oem.crossRefs.filter(c => c.oem).map((c, i) => <span key={i} className="font-mono text-amber-600 mr-3">{c.oem}</span>)}
          </div>
        )}
        {oem.analogs.some(a => a.code) && (
          <div className="mt-2 pt-2 border-t border-neutral-100 text-xs">
            <span className="text-neutral-400">ÐÐ½Ð°Ð»Ð¾Ð³Ð¸: </span>
            {oem.analogs.filter(a => a.code).map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 mr-3">
                <Badge color="purple">{a.brand}</Badge>
                <span className="font-mono text-neutral-700">{a.code}</span>
              </span>
            ))}
          </div>
        )}
        {oem.applicability && <div className="mt-2 pt-2 border-t border-neutral-100 text-xs text-neutral-600"><span className="text-neutral-400">ÐÑÐ¸Ð¼ÐµÐ½Ð¸Ð¼Ð¾ÑÑÑ: </span>{oem.applicability}</div>}
      </Card>

      <Card title="Ð¡ÑÐµÐ¼Ð° ÑÐ±Ð¾ÑÐºÐ¸">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-4">
          <div><span className="text-neutral-400 text-xs">OEM</span><br /><span className="font-mono">{scheme.oemNumber}</span></div>
          <div><span className="text-neutral-400 text-xs">Ð Ð°ÑÐ¿Ð¾Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ</span><br />{scheme.position}</div>
          <div><span className="text-neutral-400 text-xs">Ð¡ÑÐ¾ÑÐ¾Ð½Ð°</span><br />{scheme.side}</div>
          <div><span className="text-neutral-400 text-xs">ÐÐ»Ð¸Ð½Ð°</span><br /><span className="text-[#ED1C24] font-mono font-semibold">{scheme.totalLength || 'â'} Ð¼Ð¼</span></div>
          <div><span className="text-neutral-400 text-xs">Ð¨Ð»Ð°Ð½Ð³Ð¾Ð²</span><br />{scheme.lines.length}</div>
        </div>
        {scheme.lines.map((line, i) => (
          <div key={i} className="bg-neutral-50 rounded-lg p-3 mb-2 border-l-4 border-l-[#ED1C24]">
            <div className="text-[11px] text-neutral-400 mb-1.5">Ð¨Ð»Ð°Ð½Ð³ #{i + 1}</div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-x-4 gap-y-1 text-xs">
              {line.fitting1 && <div><span className="text-neutral-400">Ð¤1:</span> <span className="font-mono text-[#ED1C24]">{line.fitting1}</span></div>}
              {line.insert1 && <div><span className="text-neutral-400">ÐÑÑ:</span> <span className="font-mono">{line.insert1}</span></div>}
              {line.bend1 && <div><span className="text-neutral-400">ÐÐ°Ð³Ð¸Ð±:</span> <span className="font-mono">{line.bend1}</span></div>}
              {line.cut && <div><span className="text-neutral-400">CUT:</span> <span className="font-mono text-green-700 font-semibold">{line.cut}</span></div>}
              {line.fitting2 && <div><span className="text-neutral-400">Ð¤2:</span> <span className="font-mono text-[#ED1C24]">{line.fitting2}</span></div>}
              {line.bolt && <div><span className="text-neutral-400">ÐÐ¾Ð»Ñ:</span> <span className="font-mono">{line.bolt}</span></div>}
              {line.support1 && <div><span className="text-neutral-400">ÐÑÐµÐ¿:</span> <span className="font-mono text-amber-600">{line.support1}</span></div>}
              {line.support2 && <div><span className="text-neutral-400">ÐÑÐµÐ¿2:</span> <span className="font-mono text-amber-600">{line.support2}</span></div>}
            </div>
          </div>
        ))}
        {scheme.noteRus && <div className="mt-3 pt-3 border-t border-neutral-100 text-xs text-neutral-600"><span className="text-neutral-400">ÐÑÐ¸Ð¼ÐµÑÐ°Ð½Ð¸Ðµ: </span>{scheme.noteRus}</div>}
      </Card>
    </div>
  )
}

// ==================== SIDEBAR LIST ====================
function RecordList({ records, activeId, onSelect, onDelete }: {
  records: SavedRecord[]; activeId: string | null; onSelect: (r: SavedRecord) => void; onDelete: (id: string) => void
}) {
  if (!records.length) return (
    <div className="text-center text-neutral-400 text-xs py-8">
      <Database size={28} className="mx-auto mb-2 opacity-30" />
      <p>ÐÐµÑ Ð·Ð°Ð¿Ð¸ÑÐµÐ¹</p>
    </div>
  )
  const sc = { draft: 'gray', step1: 'orange', complete: 'green' } as const
  const sl = { draft: 'Ð§ÐµÑÐ½Ð¾Ð²Ð¸Ðº', step1: 'Ð¨Ð°Ð³ 1', complete: 'ÐÐ¾ÑÐ¾Ð²Ð¾' } as const
  return (
    <div className="space-y-0.5">
      {records.map(r => (
        <div key={r.id} onClick={() => onSelect(r)}
          className={cl('group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all',
            r.id === activeId ? 'bg-red-50 border border-[#ED1C24]/30' : 'hover:bg-neutral-100 border border-transparent')}>
          <div className="min-w-0">
            <div className="font-mono text-xs text-neutral-900 truncate">{r.oem.helCode || r.oem.oem || 'â'}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge color={sc[r.status]}>{sl[r.status]}</Badge>
              <span className="text-[10px] text-neutral-400">{r.oem.position}</span>
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); onDelete(r.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded text-[#ED1C24] cursor-pointer"><Trash2 size={12} /></button>
        </div>
      ))}
    </div>
  )
}

// ==================== MAIN APP ====================
export default function App() {
  const [nav, setNav] = useState<'fill' | 'search' | 'analytics'>('fill')
  const [step, setStep] = useState(0)
  const [oemData, setOemData] = useState<OemData>(emptyOem())
  const [schemeData, setSchemeData] = useState<SchemeData>(emptyScheme())
  const [records, setRecords] = useState<SavedRecord[]>([])
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dbConnected, setDbConnected] = useState(false)
  const [catalogs, setCatalogs] = useState<Catalogs>(EMPTY_CATALOGS)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Load records and catalogs from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        const [recs, cats] = await Promise.all([
          db.loadRecords(),
          db.loadCatalogs(),
        ])
        setRecords(recs)
        setCatalogs(cats)
        setDbConnected(true)
      } catch (e: any) {
        console.error('DB load error:', e)
        showToast('ÐÑÐ¸Ð±ÐºÐ° Ð·Ð°Ð³ÑÑÐ·ÐºÐ¸: ' + (e.message || 'unknown'))
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
      // Refresh list from DB
      const recs = await db.loadRecords()
      setRecords(recs)
      setActiveRecordId(id)
      showToast('Ð¡Ð¾ÑÑÐ°Ð½ÐµÐ½Ð¾ Ð² Ð±Ð°Ð·Ñ')
    } catch (e: any) {
      console.error('Save error:', e)
      showToast('ÐÑÐ¸Ð±ÐºÐ° ÑÐ¾ÑÑÐ°Ð½ÐµÐ½Ð¸Ñ: ' + (e.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }, [activeRecordId, oemData, schemeData, step])

  const selectRecord = (r: SavedRecord) => {
    setOemData(r.oem); setSchemeData(r.scheme || emptyScheme(r.oem.oem))
    setActiveRecordId(r.id); setStep(r.status === 'complete' ? 2 : r.status === 'step1' ? 1 : 0)
  }

  const deleteRecord = async (id: string) => {
    try {
      await db.deleteRecord(id)
      setRecords(prev => prev.filter(r => r.id !== id))
      if (activeRecordId === id) newRecord()
      showToast('Ð£Ð´Ð°Ð»ÐµÐ½Ð¾')
    } catch (e: any) {
      showToast('ÐÑÐ¸Ð±ÐºÐ° ÑÐ´Ð°Ð»ÐµÐ½Ð¸Ñ: ' + (e.message || 'unknown'))
    }
  }

  const goNext = async () => {
    if (step === 0) {
      if (!oemData.oem) { showToast('Ð£ÐºÐ°Ð¶Ð¸ÑÐµ OEM Ð½Ð¾Ð¼ÐµÑ'); return }
      setSchemeData(prev => ({ ...prev, oemNumber: oemData.oem }))
      await saveRecord()
    }
    if (step === 1) await saveRecord()
    setStep(s => Math.min(s + 1, 2))
  }

  return (
    <div className="min-h-screen flex bg-neutral-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-neutral-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-neutral-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#ED1C24] flex items-center justify-center font-black text-sm text-white tracking-tight">H</div>
            <div>
              <div className="font-bold text-sm text-neutral-900 tracking-tight">HEL Baza</div>
              <div className="text-[10px] text-neutral-400 uppercase tracking-widest">PIM ÐÐ°Ð¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ðµ</div>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-2 text-[10px]">
            {dbConnected ? (
              <><Cloud size={10} className="text-green-600" /><span className="text-green-600">Supabase Â· {catalogs.fittings.length} ÑÐ¸Ñ.</span></>
            ) : (
              <><CloudOff size={10} className="text-red-500" /><span className="text-red-500">Offline</span></>
            )}
          </div>
        </div>

        <nav className="p-1.5 border-b border-neutral-200">
          {[
            { id: 'fill' as const, icon: Database, label: 'ÐÐ°Ð¿Ð¾Ð»Ð½ÐµÐ½Ð¸Ðµ' },
            { id: 'search' as const, icon: Search, label: 'ÐÐ¾Ð¸ÑÐº' },
            { id: 'analytics' as const, icon: BarChart3, label: 'Ð¡ÑÐ°ÑÐ¸ÑÑÐ¸ÐºÐ°' },
          ].map(item => (
            <button key={item.id} onClick={() => setNav(item.id)}
              className={cl('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all',
                nav === item.id ? 'bg-red-50 text-[#ED1C24] font-medium' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700')}>
              <item.icon size={15} />{item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-1.5">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-[10px] text-neutral-400 font-semibold uppercase tracking-widest">ÐÐ°Ð¿Ð¸ÑÐ¸ ({records.length})</span>
            <button onClick={newRecord} className="p-1 hover:bg-neutral-100 rounded text-neutral-400 cursor-pointer"><Plus size={14} /></button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-neutral-300" /></div>
          ) : (
            <RecordList records={records} activeId={activeRecordId} onSelect={selectRecord} onDelete={deleteRecord} />
          )}
        </div>

        <div className="p-2.5 border-t border-neutral-200">
          <Btn onClick={() => showToast('Excel Ð¸Ð¼Ð¿Ð¾ÑÑ â Ð² ÑÐ°Ð·ÑÐ°Ð±Ð¾ÑÐºÐµ')} variant="secondary" size="sm" className="w-full justify-center">
            <FileSpreadsheet size={13} /> ÐÐ¼Ð¿Ð¾ÑÑ Excel
          </Btn>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-neutral-200 flex items-center justify-between px-5 bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <Wrench size={15} className="text-neutral-400" />
            <span className="font-medium text-sm text-neutral-700">
              {activeRecordId ? `${oemData.helCode || oemData.oem || 'ÐÐ¾Ð²Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑ'}` : 'ÐÐ¾Ð²Ð°Ñ Ð·Ð°Ð¿Ð¸ÑÑ'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {activeRecordId && <Btn onClick={() => { setOemData({ ...oemData, helCode: '', oem: '' }); setSchemeData(emptyScheme()); setActiveRecordId(null); setStep(0); showToast('Ð¨Ð°Ð±Ð»Ð¾Ð½ ÑÐºÐ¾Ð¿Ð¸ÑÐ¾Ð²Ð°Ð½') }} variant="ghost" size="sm"><Copy size={13} /></Btn>}
            <Btn onClick={newRecord} variant="secondary" size="sm"><Plus size={13} /></Btn>
            <Btn onClick={saveRecord} variant="primary" size="sm" disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Ð¡Ð¾ÑÑÐ°Ð½Ð¸ÑÑ
            </Btn>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <StepIndicator current={step} steps={['OEM', 'Ð¡ÑÐµÐ¼Ð°', 'ÐÑÐ¾Ð²ÐµÑÐºÐ°']} />

          {step === 0 && <Step1Oem data={oemData} onChange={setOemData} />}
          {step === 1 && <Step2Scheme data={schemeData} onChange={setSchemeData} catalogs={catalogs} />}
          {step === 2 && <Step3Review oem={oemData} scheme={schemeData} />}

          <div className="flex justify-between mt-6 pb-4">
            <Btn onClick={() => setStep(s => Math.max(s - 1, 0))} variant="secondary" disabled={step === 0}>
              <ChevronLeft size={15} /> ÐÐ°Ð·Ð°Ð´
            </Btn>
            {step < 2 ? (
              <Btn onClick={goNext} variant="primary" disabled={saving}>
                {saving && <Loader2 size={13} className="animate-spin" />}
                {step === 0 ? 'Ð ÑÑÐµÐ¼Ðµ' : 'ÐÑÐ¾Ð²ÐµÑÐºÐ°'} <ChevronRight size={15} />
              </Btn>
            ) : (
              <Btn onClick={async () => { await saveRecord(); showToast('Ð¡Ð¾ÑÑÐ°Ð½ÐµÐ½Ð¾ Ð² Ð±Ð°Ð·Ñ') }} variant="success" disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={15} />} Ð Ð±Ð°Ð·Ñ
              </Btn>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-5 right-5 bg-white border border-neutral-200 rounded-lg px-4 py-2.5 shadow-lg flex items-center gap-2 text-sm animate-[fadeIn_0.15s]">
          <AlertCircle size={14} className="text-[#ED1C24]" />{toast}
        </div>
      )}
    </div>
  )
}
