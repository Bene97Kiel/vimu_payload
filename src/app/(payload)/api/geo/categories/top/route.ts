import configPromise from '@payload-config'
import { getPayload } from 'payload'

export const GET = async () => {
  const payload = await getPayload({ config: configPromise })

  const { docs: topCategories } = await payload.find({
    collection: 'categories',
    where: { name: { not_equals: 'More' } },
    limit: 4,
  })

  const { docs: moreCategories } = await payload.find({
    collection: 'categories',
    where: { name: { equals: 'More' } },
    limit: 1,
  })

  return Response.json([...topCategories, ...moreCategories])
}
