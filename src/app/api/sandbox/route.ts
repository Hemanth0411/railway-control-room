import { NextResponse } from 'next/server'

import { ensureSandbox, getSandboxStatus } from '@/api/sandbox'
import { errorResponse, readJsonBody, requireString } from '@/api/http'
import { requireAccessToken } from '@/auth/access-token'
import { getConfig } from '@/config'

export async function GET(request: Request) {
  try {
    const token = await requireAccessToken()
    const params = new URL(request.url).searchParams
    const status = await getSandboxStatus(
      token,
      requireString(params.get('projectId'), 'projectId'),
      requireString(params.get('environmentId'), 'environmentId'),
    )
    return NextResponse.json(status)
  } catch (cause) {
    return errorResponse(cause)
  }
}

export async function POST(request: Request) {
  try {
    const token = await requireAccessToken()
    const body = await readJsonBody(request)
    const result = await ensureSandbox(
      token,
      requireString(body.projectId, 'projectId'),
      requireString(body.environmentId, 'environmentId'),
      getConfig().sandboxImage,
    )
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (cause) {
    return errorResponse(cause)
  }
}
