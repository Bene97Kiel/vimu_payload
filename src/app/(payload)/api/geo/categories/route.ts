import configPromise from '@payload-config'
import { getPayload } from 'payload'

export const GET = async () => {
  const payload = await getPayload({ config: configPromise })

  const { docs } = await payload.find({
    collection: 'categories',
    where: { name: { not_equals: 'More' } },
    pagination: false,
  })

  return Response.json(docs)
}
