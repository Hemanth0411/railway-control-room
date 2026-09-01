import { NextResponse } from 'next/server'

import { errorResponse } from '@/api/http'
import { requireAccessToken } from '@/auth/access-token'
import { evaluateActions, primaryAction } from '@/domain/actions'
import { getDeployment } from '@/railway/client'

/**
 * One observation per request. This is what the browser polls, so it deliberately makes
 * a single Railway call - the Free plan only allows 100 an hour.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    const token = await requireAccessToken()
    const { deploymentId } = await params
    const { data, rateLimit } = await getDeployment(token, deploymentId)

    return NextResponse.json({
      deployment: data,
      actions: evaluateActions(data),
      primaryAction: primaryAction(data),
      rateLimit,
    })
  } catch (cause) {
    return errorResponse(cause)
  }
}
