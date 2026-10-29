import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Falta DATABASE_URL. Copiá .env.example a .env y configurá la conexión PostgreSQL.')
  process.exitCode = 1
} else {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const migrationUrl = new URL('./migrations/001_initial.sql', import.meta.url)
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8')
    await pool.query(migration)
    console.info('Migración 001 aplicada correctamente.')
  } catch (error) {
    console.error('No se pudo aplicar la migración de AtHouse.', error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
