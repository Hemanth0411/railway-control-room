import { NextResponse } from 'next/server'

import { requireAccessToken } from '@/auth/access-token'
import { errorResponse, requireString } from '@/api/http'
import { listEnvironments } from '@/railway/client'

export async function GET(request: Request) {
  try {
    const token = await requireAccessToken()
    const projectId = requireString(
      new URL(request.url).searchParams.get('projectId'),
      'projectId',
    )
    const { data, rateLimit } = await listEnvironments(token, projectId)
    return NextResponse.json({ environments: data, rateLimit })
  } catch (cause) {
    return errorResponse(cause)
  }
}
