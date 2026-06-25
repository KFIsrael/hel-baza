import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'
import { Plus, X, Save, Loader2, ChevronUp, ChevronDown, FlipHorizontal } from 'lucide-react'
import {
  HelSchemeCard, getSchemeLines, washersForBoltCat, WASHER_SKU_CAT, HOSE_COLORS,
  type BrakelineProduct, type Specs, type SchemeLine, type HelMap,
} from './BrakelineCatalog'

// ── Справочники для дропдаунов ──────────────────────────────────────────────
interface CatItem { code: string; name: string }
interface EditorCatalogs {
  fittings: CatItem[]; inserts: CatItem[]; bolts: CatItem[]; supports: CatItem[]
  washers: CatItem[]; angles: string[]; orients: string[]
}
const EMPTY: EditorCatalogs = { fittings: [], inserts: [], bolts: [], supports: [], washers: [], angles: [], orients: [] }

const SIDES = ['LEFT', 'RIGHT', 'LEFT/RIGHT', 'MIDDLE', 'MIDDLE LEFT', 'MIDDLE RIGHT', 'MIDDLE LEFT/RIGHT', 'LEFT(Drum)', 'RIGHT(Drum)', 'LEFT(Disc)', 'RIGHT(Disc)']
const POSITIONS = ['FRONT', 'REAR', 'MIDDLE']

const emptyLine = (): SchemeLine => ({
  fitting1: '', insert1: '', bend1: '', bend1_orient: '', bolt1: '',
  cut: '', supports: [], supports_flipped: [],
  fitting2: '', insert2: '', bend2: '', bend2_orient: '', bolt2: '',
})

// Маленький справочный <select>
function Sel({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: CatItem[] | string[]; placeholder: string
}) {
  const opts = options.map(o => (typeof o === 'string' ? { code: o, name: o } : o))
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded-lg bg-white font-mono focus:outline-none focus:ring-1 focus:ring-[#ED1C24]">
      <option value="">{placeholder}</option>
      {opts.map(o => <option key={o.code} value={o.code}>{o.code}{o.name && o.name !== o.code ? ` — ${o.name}` : ''}</option>)}
    </select>
  )
}

function FieldLbl({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">{children}</div>
}

export function HelCardEditor({ product, helProducts, onSaved, onCancel }: {
  product: BrakelineProduct
  helProducts: HelMap
  onSaved: (updated: BrakelineProduct) => void
  onCancel: () => void
}) {
  const [cats, setCats] = useState<EditorCatalogs>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // editable state
  const [oem, setOem] = useState(product.oem || '')
  const [application, setApplication] = useState(product.application || '')
  const [hoseColor, setHoseColor] = useState((product.specs?.hose_color as string) || 'CLEAR')
  const [position, setPosition] = useState((product.specs?.position as string) || 'FRONT')
  const [side, setSide] = useState((product.specs?.side as string) || 'LEFT/RIGHT')
  const [lines, setLines] = useState<SchemeLine[]>(() => getSchemeLines(product.specs || {} as Specs))
  // OEM-замены (без основного oem) и аналоги
  const [crosses, setCrosses] = useState<string[]>(() => {
    const all = (product.original_oem || '').split(',').map(s => s.trim()).filter(Boolean)
    return all.filter(o => o.toUpperCase() !== (product.oem || '').toUpperCase())
  })
  const [analogs, setAnalogs] = useState<{ brand: string; code: string }[]>(() => {
    const parts = (product.cross_refs || '').split(',').map(s => s.trim()).filter(Boolean)
    return parts.map(p => { const m = p.match(/^(\S+)\s+(.+)$/); return m ? { brand: m[1], code: m[2] } : { brand: '', code: p } })
  })

  useEffect(() => {
    Promise.all([
      supabase.from('products').select('sku, name, full_name, category').eq('is_active', true).order('sku'),
      supabase.from('fitting_angles').select('name').order('sort_order'),
      supabase.from('bend_orientations').select('name').eq('is_active', true).order('sort_order'),
    ]).then(([prodRes, angRes, orRes]) => {
      const f: CatItem[] = [], ins: CatItem[] = [], b: CatItem[] = [], sup: CatItem[] = [], w: CatItem[] = []
      for (const p of (prodRes.data || []) as { sku: string; name: string; full_name: string | null; category: string }[]) {
        const it = { code: p.sku, name: p.full_name || p.name }
        if (['fitting_female', 'fitting_male', 'fitting_banjo'].includes(p.category)) f.push(it)
        else if (p.category === 'insert') ins.push(it)
        else if (p.category === 'banjo_bolt') b.push(it)
        else if (p.category === 'washer') w.push(it)
        else if (p.category === 'hardware') sup.push(it)
      }
      setCats({
        fittings: f, inserts: ins, bolts: b, supports: sup, washers: w,
        angles: (angRes.data || []).map((a: { name: string }) => a.name),
        orients: (orRes.data || []).map((o: { name: string }) => o.name),
      })
    })
  }, [])

  // ── мутаторы строк ─────────────────────────────────────────────────────────
  const updLine = (i: number, patch: Partial<SchemeLine>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const addLine = () => setLines(ls => [...ls, emptyLine()])
  const rmLine = (i: number) => setLines(ls => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)

  const addSupport = (li: number) => updLine(li, { supports: [...lines[li].supports, ''], supports_flipped: [...lines[li].supports_flipped, false] })
  const rmSupport = (li: number, si: number) => {
    const l = lines[li]
    updLine(li, { supports: l.supports.filter((_, i) => i !== si), supports_flipped: l.supports_flipped.filter((_, i) => i !== si) })
  }
  const setSupport = (li: number, si: number, v: string) => {
    const s = [...lines[li].supports]; s[si] = v; updLine(li, { supports: s })
  }
  const flipSupport = (li: number, si: number) => {
    const f = [...lines[li].supports_flipped]; f[si] = !f[si]; updLine(li, { supports_flipped: f })
  }
  const moveSupport = (li: number, si: number, dir: -1 | 1) => {
    const l = lines[li]; const j = si + dir
    if (j < 0 || j >= l.supports.length) return
    const s = [...l.supports], f = [...l.supports_flipped]
    ;[s[si], s[j]] = [s[j], s[si]]; [f[si], f[j]] = [f[j], f[si]]
    updLine(li, { supports: s, supports_flipped: f })
  }

  // ── live превью specs ────────────────────────────────────────────────────────
  const previewSpecs = useMemo<Specs>(() => {
    const sp: Record<string, unknown> = { ...(product.specs || {}), hose_color: hoseColor, position, side }
    sp.lines = lines.map(serializeLine)
    const l0 = lines[0]
    if (l0) {
      sp.fitting1 = l0.fitting1; sp.insert1 = l0.insert1; sp.cut = l0.cut
      sp.fitting2 = l0.fitting2; sp.insert2 = l0.insert2
      sp.bend1 = l0.bend1; sp.bend1_orient = l0.bend1_orient
      sp.bend2 = l0.bend2; sp.bend2_orient = l0.bend2_orient
      sp.bolt2 = l0.bolt2
      for (let i = 1; i <= 6; i++) { delete sp[`support${i}`]; delete sp[`support${i}_flip`] }
      l0.supports.forEach((s, i) => { if (s) { sp[`support${i + 1}`] = s; if (l0.supports_flipped[i]) sp[`support${i + 1}_flip`] = '1' } })
    }
    return sp as Specs
  }, [lines, hoseColor, position, side, product.specs])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      const original_oem = Array.from(new Set([oem, ...crosses].filter(Boolean))).join(', ')
      const cross_refs = analogs.filter(a => a.code).map(a => `${a.brand.toUpperCase()} ${a.code}`.trim()).join(', ')
      const { error } = await supabase.from('brakeline_products')
        .update({ oem: oem || null, original_oem: original_oem || null, cross_refs: cross_refs || null, application: application || null, specs: previewSpecs })
        .eq('id', product.id)
      if (error) throw error
      onSaved({ ...product, oem, original_oem, cross_refs, application, specs: previewSpecs })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Action bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 bg-neutral-50 shrink-0">
        <div className="text-sm font-bold text-neutral-700">Редактирование · <span className="font-mono text-[#ED1C24]">{product.article}</span></div>
        <div className="flex items-center gap-2">
          {err && <span className="text-xs text-[#ED1C24]">{err}</span>}
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 hover:bg-neutral-100 text-neutral-600 cursor-pointer">Отмена</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#ED1C24] hover:bg-[#d41920] text-white cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Live превью */}
        <HelSchemeCard specs={previewSpecs} pm={helProducts} />

        {/* Мета */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><FieldLbl>OEM номер</FieldLbl><input value={oem} onChange={e => setOem(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded-lg font-mono" /></div>
          <div><FieldLbl>Положение</FieldLbl><Sel value={position} onChange={setPosition} options={POSITIONS} placeholder="—" /></div>
          <div><FieldLbl>Сторона</FieldLbl><Sel value={side} onChange={setSide} options={SIDES} placeholder="—" /></div>
          <div><FieldLbl>Цвет шланга</FieldLbl><Sel value={hoseColor} onChange={setHoseColor} options={Object.keys(HOSE_COLORS)} placeholder="CLEAR" /></div>
        </div>
        <div>
          <FieldLbl>Применимость (марка, модель, годы — каждая с новой строки)</FieldLbl>
          <textarea value={application} onChange={e => setApplication(e.target.value)} rows={3} className="w-full px-2 py-1.5 text-xs border border-neutral-200 rounded-lg font-mono" />
        </div>

        {/* Шланги */}
        {lines.map((ln, li) => (
          <div key={li} className="border border-neutral-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-neutral-700">Шланг #{li + 1}</span>
              {lines.length > 1 && <button onClick={() => rmLine(li)} className="text-[#ED1C24] hover:bg-red-50 rounded p-1 cursor-pointer"><X size={14} /></button>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Фитинг 1 */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-[#ED1C24] uppercase border-b border-red-100 pb-1">Фитинг 1 (левый)</div>
                <div><FieldLbl>Фитинг</FieldLbl><Sel value={ln.fitting1} onChange={v => updLine(li, { fitting1: v })} options={cats.fittings} placeholder="Выбрать" /></div>
                <div><FieldLbl>Вставка</FieldLbl><Sel value={ln.insert1} onChange={v => updLine(li, { insert1: v })} options={cats.inserts} placeholder="Нет" /></div>
                <div><FieldLbl>Загиб / Угол</FieldLbl><Sel value={ln.bend1} onChange={v => updLine(li, { bend1: v })} options={cats.angles} placeholder="Прямой" /></div>
                <div><FieldLbl>Ориентация загиба</FieldLbl><Sel value={ln.bend1_orient} onChange={v => updLine(li, { bend1_orient: v })} options={cats.orients} placeholder="Не задана" /></div>
              </div>
              {/* Шланг / Крепления */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-neutral-400 uppercase border-b border-neutral-100 pb-1">Шланг / Крепления</div>
                <div><FieldLbl>CUT длина (мм)</FieldLbl><input value={ln.cut} onChange={e => updLine(li, { cut: e.target.value })} className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg font-mono font-bold" placeholder="435" /></div>
                {ln.supports.map((sup, si) => (
                  <div key={si} className="flex items-center gap-1">
                    <div className="flex-1"><Sel value={sup} onChange={v => setSupport(li, si, v)} options={cats.supports} placeholder={`Крепление ${si + 1}`} /></div>
                    <button onClick={() => flipSupport(li, si)} title="Зеркало" className={`p-1 rounded cursor-pointer ${ln.supports_flipped[si] ? 'bg-[#ED1C24] text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}><FlipHorizontal size={12} /></button>
                    <button onClick={() => moveSupport(li, si, -1)} className="p-1 rounded bg-neutral-100 text-neutral-500 hover:bg-neutral-200 cursor-pointer"><ChevronUp size={12} /></button>
                    <button onClick={() => moveSupport(li, si, 1)} className="p-1 rounded bg-neutral-100 text-neutral-500 hover:bg-neutral-200 cursor-pointer"><ChevronDown size={12} /></button>
                    <button onClick={() => rmSupport(li, si)} className="p-1 rounded text-[#ED1C24] hover:bg-red-50 cursor-pointer"><X size={12} /></button>
                  </div>
                ))}
                <button onClick={() => addSupport(li)} className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center gap-1"><Plus size={12} /> Добавить крепление</button>
              </div>
              {/* Фитинг 2 */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-[#ED1C24] uppercase border-b border-red-100 pb-1">Фитинг 2 (правый)</div>
                <div><FieldLbl>Фитинг</FieldLbl><Sel value={ln.fitting2} onChange={v => updLine(li, { fitting2: v })} options={cats.fittings} placeholder="Выбрать" /></div>
                <div><FieldLbl>Вставка</FieldLbl><Sel value={ln.insert2} onChange={v => updLine(li, { insert2: v })} options={cats.inserts} placeholder="Нет" /></div>
                <div><FieldLbl>Загиб / Угол</FieldLbl><Sel value={ln.bend2} onChange={v => updLine(li, { bend2: v })} options={cats.angles} placeholder="Прямой" /></div>
                <div><FieldLbl>Ориентация загиба</FieldLbl><Sel value={ln.bend2_orient} onChange={v => updLine(li, { bend2_orient: v })} options={cats.orients} placeholder="Не задана" /></div>
                <div><FieldLbl>Болт (Banjo)</FieldLbl><Sel value={ln.bolt2} onChange={v => updLine(li, { bolt2: v })} options={cats.bolts} placeholder="Нет болта" /></div>
                {ln.bolt2 && <div className="text-[10px] text-neutral-500">Шайбы: {WASHER_SKU_CAT} ×{washersForBoltCat(ln.bolt2)}</div>}
              </div>
            </div>
          </div>
        ))}
        <button onClick={addLine} className="text-sm text-[#ED1C24] hover:bg-red-50 rounded-lg px-3 py-1.5 cursor-pointer flex items-center gap-1 border border-red-200"><Plus size={14} /> Добавить шланг</button>

        {/* Кросс-OEM и аналоги */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-neutral-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-neutral-400 uppercase mb-2">OEM-замены</div>
            {crosses.map((cr, i) => (
              <div key={i} className="flex gap-1 mb-1.5">
                <input value={cr} onChange={e => setCrosses(cs => cs.map((x, idx) => idx === i ? e.target.value : x))} className="flex-1 px-2 py-1 text-xs border border-neutral-200 rounded font-mono" />
                <button onClick={() => setCrosses(cs => cs.filter((_, idx) => idx !== i))} className="p-1 text-[#ED1C24] hover:bg-red-50 rounded cursor-pointer"><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => setCrosses(cs => [...cs, ''])} className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center gap-1"><Plus size={12} /> Добавить замену</button>
          </div>
          <div className="border border-neutral-200 rounded-xl p-4">
            <div className="text-[10px] font-bold text-neutral-400 uppercase mb-2">Аналоги (бренд + артикул)</div>
            {analogs.map((a, i) => (
              <div key={i} className="flex gap-1 mb-1.5">
                <input value={a.brand} onChange={e => setAnalogs(as => as.map((x, idx) => idx === i ? { ...x, brand: e.target.value } : x))} placeholder="Бренд" className="w-1/3 px-2 py-1 text-xs border border-neutral-200 rounded font-mono" />
                <input value={a.code} onChange={e => setAnalogs(as => as.map((x, idx) => idx === i ? { ...x, code: e.target.value } : x))} placeholder="Артикул" className="flex-1 px-2 py-1 text-xs border border-neutral-200 rounded font-mono" />
                <button onClick={() => setAnalogs(as => as.filter((_, idx) => idx !== i))} className="p-1 text-[#ED1C24] hover:bg-red-50 rounded cursor-pointer"><X size={12} /></button>
              </div>
            ))}
            <button onClick={() => setAnalogs(as => [...as, { brand: '', code: '' }])} className="text-xs text-neutral-400 hover:text-neutral-700 cursor-pointer flex items-center gap-1"><Plus size={12} /> Добавить аналог</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// сериализация строки в specs.lines[] (с расчётом шайб)
function serializeLine(ln: SchemeLine) {
  const keep = ln.supports.map((sk, idx) => ({ sk, fl: ln.supports_flipped[idx] ?? false })).filter(x => x.sk)
  return {
    fitting1: ln.fitting1 || '', fitting1_extra: '', insert1: ln.insert1 || '',
    bend1: ln.bend1 || '', bend1_orient: ln.bend1_orient || '',
    bolt1: ln.bolt1 || '', bolt1_washer: ln.bolt1 ? WASHER_SKU_CAT : '', bolt1_washer_qty: ln.bolt1 ? washersForBoltCat(ln.bolt1) : 0,
    cut: ln.cut || '', supports: keep.map(x => x.sk), supports_flipped: keep.map(x => x.fl),
    fitting2: ln.fitting2 || '', fitting2_extra: '', insert2: ln.insert2 || '',
    bend2: ln.bend2 || '', bend2_orient: ln.bend2_orient || '',
    bolt2: ln.bolt2 || '', bolt2_washer: ln.bolt2 ? WASHER_SKU_CAT : '', bolt2_washer_qty: ln.bolt2 ? washersForBoltCat(ln.bolt2) : 0,
  }
}
