import { NextResponse } from 'next/server'

import { requireAccessToken } from '@/auth/access-token'
import { errorResponse } from '@/api/http'
import { listProjects } from '@/railway/client'

export async function GET() {
  try {
    const token = await requireAccessToken()
    const { data, rateLimit } = await listProjects(token)
    return NextResponse.json({ projects: data, rateLimit })
  } catch (cause) {
    return errorResponse(cause)
  }
}
