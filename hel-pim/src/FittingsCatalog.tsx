import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'
import { Search, X, Loader2, Package, ChevronDown, ChevronUp } from 'lucide-react'

interface Product {
  id: string; sku: string; name: string; full_name: string | null
  description: string | null; category: string; characteristic: string | null
  unit: string; barcode: string | null; image_url: string | null
  price_dealer: number | null; price_gpb_10: number | null
  price_gpb_15: number | null; price_gpb_17: number | null; price_gpb_20: number | null
}

type PriceTier = 'price_dealer' | 'price_gpb_10' | 'price_gpb_15' | 'price_gpb_17' | 'price_gpb_20'

const TIERS: { key: PriceTier; label: string }[] = [
  { key: 'price_dealer', label: 'Дилер' },
  { key: 'price_gpb_10', label: '-10%' },
  { key: 'price_gpb_15', label: '-15%' },
  { key: 'price_gpb_17', label: '-17%' },
  { key: 'price_gpb_20', label: '-20%' },
]

const CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'fitting_female', label: 'Мама',           color: '#E91E63' },
  { key: 'fitting_male',   label: 'Папа',           color: '#2196F3' },
  { key: 'fitting_banjo',  label: 'Банджо',         color: '#FF9800' },
  { key: 'banjo_bolt',     label: 'Банджо болты',   color: '#795548' },
  { key: 'insert',         label: 'Вставки',        color: '#4CAF50' },
  { key: 'hardware',       label: 'Крепёж',         color: '#607D8B' },
  { key: 'washer',         label: 'Шайбы',          color: '#9E9E9E' },
  { key: 'hose',           label: 'Рукав/гильзы',   color: '#9C27B0' },
  { key: 'abs_block',      label: 'ABS блоки',      color: '#F44336' },
  { key: 'adapter',        label: 'Адаптеры',       color: '#00BCD4' },
  { key: 'bleed_nipple',   label: 'Прокачные',      color: '#8BC34A' },
  { key: 'plug',           label: 'Пробки',         color: '#CDDC39' },
  { key: 'brake_tube',     label: 'Трубки',         color: '#FF5722' },
  { key: 'branded',        label: 'Брендированные', color: '#673AB7' },
  { key: 'mtb_fitting',    label: 'Вело',           color: '#009688' },
  { key: 'tooling',        label: 'Оснастка',       color: '#3F51B5' },
]

function fmtPrice(n: number | null): string {
  if (!n) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽'
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false)
  if (product.image_url && !failed) {
    return (
      <div className="w-full h-40 rounded-lg overflow-hidden bg-white flex items-center justify-center border border-neutral-100">
        <img src={product.image_url} alt={product.sku} className="max-h-full max-w-full object-contain p-2" onError={() => setFailed(true)} />
      </div>
    )
  }
  const cat = CATEGORIES.find(c => c.key === product.category)
  return (
    <div className="w-full h-40 rounded-lg flex flex-col items-center justify-center gap-2 select-none" style={{ background: (cat?.color || '#999') + '10' }}>
      <Package size={28} style={{ color: cat?.color || '#999', opacity: 0.4 }} />
      <span className="font-mono text-xs font-bold" style={{ color: cat?.color || '#999' }}>{product.sku}</span>
    </div>
  )
}

export function FittingsCatalog() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [tier, setTier] = useState<PriceTier>('price_dealer')
  const [selected, setSelected] = useState<Product | null>(null)

  useEffect(() => {
    supabase.from('products')
      .select('*')
      .eq('is_active', true)
      .order('category').order('sku')
      .then(({ data }) => { setProducts((data || []) as Product[]); setLoading(false) })
  }, [])

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of products) m[p.category] = (m[p.category] || 0) + 1
    return m
  }, [products])

  const filtered = useMemo(() => {
    let list = products
    if (selectedCat) list = list.filter(p => p.category === selectedCat)
    if (query.trim()) {
      const q = query.trim().toUpperCase()
      list = list.filter(p =>
        p.sku.toUpperCase().includes(q) ||
        p.name.toUpperCase().includes(q) ||
        (p.full_name || '').toUpperCase().includes(q) ||
        (p.description || '').toUpperCase().includes(q)
      )
    }
    return list
  }, [products, selectedCat, query])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-neutral-300" size={28} /></div>
  )

  return (
    <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
      {/* Left: grid */}
      <div className={`flex flex-col bg-white min-h-0 overflow-hidden transition-all duration-300 ${selected ? 'hidden md:flex w-[55%]' : 'flex-1'}`}>
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-neutral-200 space-y-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по артикулу, названию..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-neutral-200 rounded-lg bg-neutral-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#ED1C24] focus:border-[#ED1C24] font-mono" />
            {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"><X size={13} /></button>}
          </div>

          {/* Categories */}
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => setSelectedCat(null)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${!selectedCat ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'}`}>
              Все <span className="opacity-50 ml-1">{products.length}</span>
            </button>
            {CATEGORIES.filter(c => counts[c.key]).map(c => (
              <button key={c.key} onClick={() => setSelectedCat(selectedCat === c.key ? null : c.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer transition-all ${selectedCat === c.key ? 'text-white border-transparent' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'}`}
                style={selectedCat === c.key ? { backgroundColor: c.color, borderColor: c.color } : {}}>
                {c.label} <span className="opacity-50 ml-0.5">{counts[c.key]}</span>
              </button>
            ))}
          </div>

          {/* Price tier */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mr-1">Цена:</span>
            {TIERS.map(t => (
              <button key={t.key} onClick={() => setTier(t.key)}
                className={`px-2 py-1 rounded text-[10px] font-bold border cursor-pointer transition-all ${tier === t.key ? 'bg-green-600 text-white border-green-600' : 'bg-white text-neutral-400 border-neutral-200 hover:border-green-400'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="px-4 py-1.5 border-b border-neutral-100 bg-neutral-50/50 shrink-0">
          <span className="text-[11px] text-neutral-400">
            {filtered.length} из {products.length}
          </span>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center text-neutral-400 py-20">
              <Package size={36} strokeWidth={1} className="mx-auto mb-3 opacity-30" />
              <span className="text-sm">{query ? 'Ничего не найдено' : 'Нет товаров'}</span>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200 z-10">
                <tr>
                  <th className="w-28 px-2 py-2.5"></th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Категория</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Артикул</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Название</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest hidden lg:table-cell">Хар-ка</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Цена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map(p => {
                  const cat = CATEGORIES.find(c => c.key === p.category)
                  const price = p[tier]
                  const isActive = selected?.id === p.id
                  return (
                    <tr key={p.id} onClick={() => setSelected(isActive ? null : p)}
                      className={`cursor-pointer transition-colors group ${isActive ? 'bg-red-50 border-l-2 border-l-[#ED1C24]' : 'hover:bg-red-50/40 border-l-2 border-l-transparent'}`}>
                      <td className="px-2 py-1.5">
                        {p.image_url ? (
                          <div className="w-20 h-20 rounded-md overflow-hidden bg-white border border-neutral-100 flex items-center justify-center">
                            <img src={p.image_url} alt={p.sku} className="max-h-full max-w-full object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          </div>
                        ) : (
                          <div className="w-20 h-20 rounded-md flex items-center justify-center" style={{ background: (cat?.color || '#999') + '15' }}>
                            <Package size={14} style={{ color: cat?.color || '#999', opacity: 0.4 }} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-white whitespace-nowrap" style={{ backgroundColor: cat?.color || '#999' }}>
                          {cat?.label || p.category}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono font-bold text-neutral-900 group-hover:text-[#ED1C24] transition-colors whitespace-nowrap">
                        {p.sku}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-600 max-w-xs truncate">
                        {p.full_name || p.name}
                      </td>
                      <td className="px-3 py-1.5 text-neutral-400 hidden lg:table-cell whitespace-nowrap">
                        {p.characteristic || '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono font-bold text-green-700 whitespace-nowrap">
                        {fmtPrice(price)}
                        {p.unit === 'meter' && <span className="text-neutral-400 font-normal">/м</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Right: detail panel */}
      {selected && <DetailPanel product={selected} tier={tier} onClose={() => setSelected(null)} />}
    </div>
  )
}

function DetailPanel({ product, tier, onClose }: { product: Product; tier: PriceTier; onClose: () => void }) {
  const [descOpen, setDescOpen] = useState(false)
  const cat = CATEGORIES.find(c => c.key === product.category)

  return (
    <div className="flex-1 min-w-0 border-l-2 border-neutral-200 flex flex-col bg-white overflow-hidden">
      <div className="h-1 shrink-0" style={{ background: cat?.color || '#999' }} />

      {/* Header */}
      <div className="px-6 py-4 border-b border-neutral-100 shrink-0" style={{ background: (cat?.color || '#999') + '08' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white" style={{ backgroundColor: cat?.color }}>{cat?.label}</span>
            <div className="font-mono font-black text-2xl text-neutral-900 mt-1">{product.sku}</div>
            {product.characteristic && <div className="text-xs text-neutral-500 mt-0.5">{product.characteristic}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/80 rounded-lg text-neutral-400 hover:text-neutral-700 cursor-pointer"><X size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        <div className="p-5 border-b border-neutral-100">
          <ProductImage product={product} />
        </div>

        {/* Name */}
        <div className="p-5 border-b border-neutral-100">
          <div className="text-sm font-semibold text-neutral-800">{product.full_name || product.name}</div>
          {product.barcode && <div className="text-[10px] text-neutral-400 font-mono mt-1">Штрихкод: {product.barcode}</div>}
        </div>

        {/* Prices */}
        <div className="p-5 border-b border-neutral-100">
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-3">Цены</div>
          <div className="space-y-1.5">
            {TIERS.map(t => (
              <div key={t.key} className={`flex justify-between items-center px-3 py-1.5 rounded-lg ${tier === t.key ? 'bg-green-50 border border-green-200' : ''}`}>
                <span className="text-xs text-neutral-600">{t.label}</span>
                <span className={`font-mono text-sm font-bold ${tier === t.key ? 'text-green-700' : 'text-neutral-700'}`}>
                  {fmtPrice(product[t.key])}
                </span>
              </div>
            ))}
          </div>
          {product.unit === 'meter' && <div className="text-[10px] text-neutral-400 mt-2">* цена за 1 метр</div>}
        </div>

        {/* Description */}
        {product.description && (
          <div className="border-b border-neutral-100">
            <button onClick={() => setDescOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-neutral-50 cursor-pointer">
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Описание</span>
              {descOpen ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
            </button>
            {descOpen && <div className="px-5 pb-4 text-xs text-neutral-600 leading-relaxed">{product.description}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
