// app/api/generate/route.ts
// 废弃，返回 404
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
