import { NextResponse } from 'next/server'

import { errorResponse } from '@/api/http'
import { requireAccessToken } from '@/auth/access-token'
import { errors } from '@/domain/errors'
import { getBuildLogs, getRuntimeLogs } from '@/railway/client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    const token = await requireAccessToken()
    const { deploymentId } = await params
    const kind = new URL(request.url).searchParams.get('kind') ?? 'build'

    if (kind !== 'build' && kind !== 'runtime') {
      throw errors.validation("kind must be 'build' or 'runtime'.")
    }

    const fetchLogs = kind === 'build' ? getBuildLogs : getRuntimeLogs
    const { data, rateLimit } = await fetchLogs(token, deploymentId)

    return NextResponse.json({ kind, logs: data, rateLimit })
  } catch (cause) {
    return errorResponse(cause)
  }
}
