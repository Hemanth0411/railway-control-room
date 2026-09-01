import { NextResponse } from 'next/server'

import { errorResponse, requireString } from '@/api/http'
import { requireAccessToken } from '@/auth/access-token'
import { listDeployments } from '@/railway/client'

export async function GET(request: Request) {
  try {
    const token = await requireAccessToken()
    const params = new URL(request.url).searchParams

    const { data, rateLimit } = await listDeployments(
      token,
      requireString(params.get('projectId'), 'projectId'),
      requireString(params.get('environmentId'), 'environmentId'),
      requireString(params.get('serviceId'), 'serviceId'),
    )

    return NextResponse.json({ deployments: data, rateLimit })
  } catch (cause) {
    return errorResponse(cause)
  }
}
