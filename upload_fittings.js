import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const sb = createClient(
  'https://uspakygxibqcicmsjvct.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzcGFreWd4aWJxY2ljbXNqdmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTYyODIsImV4cCI6MjA5MDk5MjI4Mn0.cRn3uhaT5JwuqdvfuXXI-T2zfXWE0bGNAr0tmpq3AuM'
)

const BASE = 'C:/Users/W5586/Desktop/Hel_baza/Фитинги'
const BUCKET = 'fitting-images'
const STORAGE_URL = `https://uspakygxibqcicmsjvct.supabase.co/storage/v1/object/public/${BUCKET}`

const FOLDER_MAP = {
  'Мама': 'fitting_female',
  'Папа': 'fitting_male',
  'Банджо': 'fitting_banjo',
  'Банджо болты': 'banjo_bolt',
  'Вставки в фитинги': 'insert',
  'Адаптеры': 'adapter',
  'АБС блоки - SP блоки': 'abs_block',
  'Рукав и гильзы': 'hose',
  'Клипсы_Локаторы': 'hardware',
  'Пробки_Заглушки': 'plug',
  'Прокачные ниппеля + банджо болты для ниппелей': 'bleed_nipple',
}

async function main() {
  let uploaded = 0, skipped = 0, errors = 0
  const imageMap = new Map() // sku -> primary image url

  for (const [folder, category] of Object.entries(FOLDER_MAP)) {
    const dir = path.join(BASE, folder)
    if (!fs.existsSync(dir)) { console.log(`SKIP missing: ${folder}`); continue }

    const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    console.log(`\n${folder}: ${files.length} files`)

    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) continue

      const storagePath = `${category}/${file}`
      const buf = fs.readFileSync(filePath)
      const contentType = file.endsWith('.png') ? 'image/png' : 'image/jpeg'

      const { error } = await sb.storage.from(BUCKET).upload(storagePath, buf, {
        contentType,
        upsert: true,
      })

      if (error) {
        console.log(`  ERR ${file}: ${error.message}`)
        errors++
      } else {
        uploaded++
        // Extract SKU from filename: H652-31CN.jpg -> H652-31CN, H692-BLUE-1.jpg -> H692-BLUE (extra photo)
        const name = path.parse(file).name
        const sku = name.replace(/-\d+$/, '') // remove -1, -2 suffix
        const url = `${STORAGE_URL}/${storagePath}`

        // Only set primary image (first one without -N suffix)
        if (!imageMap.has(sku) || !name.match(/-\d+$/)) {
          imageMap.set(sku, url)
        }
        process.stdout.write('.')
      }
    }
  }

  console.log(`\n\nUploaded: ${uploaded}, Skipped: ${skipped}, Errors: ${errors}`)
  console.log(`Image URLs to update: ${imageMap.size}`)

  // Update products table with image URLs
  let updated = 0
  for (const [sku, url] of imageMap) {
    const { error, count } = await sb.from('products')
      .update({ image_url: url })
      .eq('sku', sku)

    if (error) {
      console.log(`  Update ERR ${sku}: ${error.message}`)
    } else {
      updated++
    }
  }
  console.log(`Products updated with image_url: ${updated}`)
}

main().catch(console.error)
