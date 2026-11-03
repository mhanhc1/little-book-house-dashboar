/* Little Book House: Netlify Function (read-only) for Supabase dashboard.
   Store secrets only as Netlify environment variables, never in the browser.
   Runtime requires Node 18+ (native fetch). No npm dependencies. */
'use strict';
const crypto = require('node:crypto');
const PROJECT_REF = 'rkbzwslvxtpoelfbwydf'; // Public project ref; not a secret.
const PAGE_SIZE = 800;
const MAX_ROWS = 16000; // Safeguard: fail loudly rather than silently truncate.
const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'X-Dashboard-Password'
  },
  body: JSON.stringify(body)
});
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}
class DataError extends Error { constructor(message, status=502) {super(message); this.status=status;} }
const value = (process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`).replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

async function requestRows(table, columns, page) {
  const url = new URL(`${value}/rest/v1/${table}`);
  url.searchParams.set('select', columns.join(','));
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(page * PAGE_SIZE));
  // Stable pagination; for order_items there may not be an id column.
  if (table === 'orders' || table === 'books') url.searchParams.set('order', 'id.asc');
  else url.searchParams.set('order', 'order_id.asc');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const k = key();
    const headers = {apikey:k, Accept:'application/json'};
    // New sb_secret_ keys are NOT JWTs: only send via apikey.
    // Legacy service_role JWT accepts Authorization: Bearer.
    if (!k.startsWith('sb_secret_')) headers.Authorization = `Bearer ${k}`;
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: 'no-store'
    });
    let payload;
    try {payload = await res.json();}catch {throw new DataError(`Supabase không trả về JSON ở bảng ${table}.`);}
    if (!res.ok) {
      const code = payload?.code || '';
      const msg = String(payload?.message || '');
      // Schema fallback only for missing columns (Postgres 42703).
      if ((code === '42703' || code === 'PGRST200' || /column\s+.*does not exist/i.test(msg)) && res.status < 500)
        throw new DataError('Cột không khớp: ' + msg.slice(0,180), 422);
      throw new DataError(`Lỗi khi đọc bảng ${table} (HTTP ${res.status}; mã ${code || 'không rõ'}).`);
    }
    if (!Array.isArray(payload)) throw new DataError(`Phản hồi bảng ${table} không phải danh sách.`);
    return payload;
  } finally {clearTimeout(timer);}
}
async function queryTable(table, profiles) {
  let error;
  for (let i=0;i<profiles.length;i++) {
    const cols = profiles[i];
    try {
      const out=[];
      for(let page=0;page <= Math.ceil(MAX_ROWS/PAGE_SIZE);page++) {
        const part=await requestRows(table,cols,page);
        if (out.length + part.length > MAX_ROWS)
          throw new DataError(`Bảng ${table} vượt quá ${MAX_ROWS} dòng. Cần chuyển sang thống kê phía máy chủ thay vì tải tất cả dòng.`,413);
        out.push(...part);
        if (part.length < PAGE_SIZE) return {rows:out, profile:i};
      }
    } catch(e) {
      error=e;
      // Try the next schema profile only if a column is missing on first page.
      if (!(e instanceof DataError && e.status===422)) throw e;
    }
  }
  throw new DataError(`Không tìm được cấu trúc phù hợp cho bảng ${table}. ${error?.message||''}`);
}
const profiles = {
  orders: [
    ['id','created_at','total_amount','status'],
    ['id','created_at','total_amount'],
    ['id','created_at','total','status'],
    ['id','created_at','total']
  ],
  order_items: [
    ['order_id','book_title','quantity','line_total'],
    ['order_id','book_id','quantity','line_total'],
    ['order_id','book_title','quantity','total_price'],
    ['order_id','book_id','quantity','total_price']
  ],
  books: [
    ['id','title','category'],
    ['id','title'],
    ['id','name','category'],
    ['id','name']
  ]
};
exports.handler = async function(event) {
  if ((event.httpMethod || 'GET') !== 'GET')
    return json(405,{error:'Chỉ hỗ trợ GET.'});
  if (!process.env.DASHBOARD_PASSWORD || !key())
    return json(503,{error:'Chưa cấu hình DASHBOARD_PASSWORD hoặc SUPABASE_SERVICE_ROLE_KEY trong Netlify.'});
  if (!safeEqual(event.headers?.['x-dashboard-password'] || event.headers?.['X-Dashboard-Password'] || '', process.env.DASHBOARD_PASSWORD))
    return json(401,{error:'Chưa được phép truy cập dashboard.'});
  try {
    const [ord,it,bk] = await Promise.all([
      queryTable('orders',profiles.orders),
      queryTable('order_items',profiles.order_items),
      queryTable('books',profiles.books)
    ]);
    const warnings=[];
    if(ord.profile)warnings.push('Bảng orders dùng cấu trúc thay thế (không đủ các cột mặc định).');
    if(it.profile)warnings.push('Bảng order_items dùng cấu trúc thay thế.');
    if(bk.profile)warnings.push('Bảng books thiếu cột danh mục chuẩn hoặc dùng tên trường khác.');
    // Return only selected analytics fields, no customer personal information.
    return json(200, {
      source:'Supabase', project:PROJECT_REF,
      fetchedAt:new Date().toISOString(),
      orders:ord.rows, order_items:it.rows, books:bk.rows, warnings
    });
  } catch(e) {
    return json(e.status || 502,{error:e instanceof DataError?e.message:'Kết nối Supabase thất bại; xem Function Logs để xác định nguyên nhân.'});
  }
};
