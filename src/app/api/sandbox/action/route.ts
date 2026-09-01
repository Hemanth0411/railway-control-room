import { NextResponse } from 'next/server'

import { errorResponse, readJsonBody, requireAction, requireString } from '@/api/http'
import { runSandboxAction } from '@/api/sandbox'
import { requireAccessToken } from '@/auth/access-token'

export async function POST(request: Request) {
  try {
    const token = await requireAccessToken()
    const body = await readJsonBody(request)

    const result = await runSandboxAction(
      token,
      requireString(body.projectId, 'projectId'),
      requireString(body.environmentId, 'environmentId'),
      requireAction(body.action),
      typeof body.expectedDeploymentId === 'string' ? body.expectedDeploymentId : undefined,
    )

    return NextResponse.json(result, { status: 202 })
  } catch (cause) {
    return errorResponse(cause)
  }
}
