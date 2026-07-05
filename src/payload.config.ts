import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Provider } from './collections/Providers'
import { Sites } from './collections/Sites'
import { Valuables } from './collections/Valuables'
import { Categories } from './collections/Categories'
import { UserValuables } from './collections/UserValuables'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Provider, Sites, Valuables, Categories, UserValuables],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  // The in-app 3D model viewer renders inside a WebView that serves its own
  // local bundle from an ephemeral localhost port, then fetches .glb files
  // from this API as a genuine cross-origin browser request — that origin
  // can't be allowlisted (it changes every run). Reads are already public
  // with no auth (Media, Categories, Providers, Sites, Valuables all have
  // `read: () => true`), so allowing all origins here doesn't loosen access —
  // writes still require a valid JWT regardless of CORS. Confirmed with the
  // developer before applying.
  cors: '*',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: mongooseAdapter({
    url: process.env.DATABASE_URL || '',
  }),
  email: nodemailerAdapter({
    defaultFromAddress: process.env.AUTH_EMAIL || '',
    defaultFromName: 'ViMu',
    // Skips the on-init connectivity check (a real network round-trip to Gmail's
    // SMTP on every `getPayload()` call) — actual send errors still surface when
    // an email is really sent, this just avoids paying that latency at every boot.
    skipVerify: true,
    transportOptions: {
      service: 'gmail',
      auth: {
        user: process.env.AUTH_EMAIL,
        pass: process.env.AUTH_PASSWORD,
      },
    },
  }),
  sharp,
  plugins: [],
})
