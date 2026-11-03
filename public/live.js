(() => {
  'use strict';
  // Mật khẩu chỉ được giữ trong bộ nhớ của tab; không ghi localStorage/cookie.
  let password = '';
  let intervalId = null;
  let inFlight = false;
  let lastLiveMaxDate = '';
  const API = '/.netlify/functions/dashboard';
  const status = (message, cls = '') => {
    const dot = $('liveDot');
    dot.className = 'live-dot' + (cls ? ` ${cls}` : '');
    $('pollStatus').textContent = message;
  };
  const stop = () => { if (intervalId) clearInterval(intervalId); intervalId = null; };
  function disconnect() {
    password = '';
    stop();
    $('refreshBtn').disabled = true;
    $('disconnectBtn').disabled = true;
    $('connectBtn').disabled = false;
    $('livePassword').value = '';
    status('Chưa kết nối Supabase');
    // Xóa ngay dữ liệu quản trị khỏi giao diện khi ngắt kết nối.
    tables = {books:[], orders:[], items:[], joined:[]};
    loadModel(tables, 'empty', 'Đã ngắt kết nối Supabase');
    setMsg('Đã ngắt kết nối. Số liệu quản trị không còn hiển thị trên trang.', 'warn');
  }
  function applyPayload(data) {
    const oldLive = state.mode === 'live';
    const oldFilters = {
      from:$('from').value, to:$('to').value,
      cat:$('cat').value,book:$('book').value,status:$('status').value,
      max:state.orders.map(x=>x.date).filter(Boolean).sort().at(-1) || ''
    };
    // Các trường được chuẩn hóa ở server; client dùng bộ dựng dashboard hiện có.
    tables = {books:data.books || [], orders:data.orders || [], items:data.order_items || [], joined:[]};
    loadModel(tables, 'live', 'Supabase · đồng bộ tự động mỗi 30 giây');
    if (oldLive) {
      $('from').value = oldFilters.from;
      $('to').value = oldFilters.to === oldFilters.max ?
        (state.orders.map(x=>x.date).filter(Boolean).sort().at(-1) || oldFilters.to) : oldFilters.to;
      for (const id of ['cat','book','status']) {
        const v=oldFilters[id];
        if ([...$(id).options].some(o=>o.value===v)) $(id).value=v;
      }
      refresh();
    }
    const date = new Date(data.fetchedAt || Date.now());
    $('lastUpdated').textContent = 'Cập nhật lúc: ' + date.toLocaleTimeString('vi-VN');
    if (data.warnings?.length) setMsg('Đã lấy dữ liệu. Lưu ý: ' + data.warnings.join(' | '), 'warn');
    else setMsg('Đã đồng bộ dữ liệu thật từ Supabase. Mỗi 30 giây hệ thống sẽ kiểm tra đơn mới.');
  }
  async function loadLive() {
    if (!password || inFlight || document.visibilityState === 'hidden') return;
    inFlight = true;
    status('Đang đồng bộ...', '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch(API, {
        headers: {'X-Dashboard-Password': password},
        cache:'no-store', signal:controller.signal
      });
      let data;
      try { data = await r.json(); } catch { throw new Error('Máy chủ không trả về JSON hợp lệ. Hãy kiểm tra Netlify Functions.'); }
      if (!r.ok) {
        if (r.status === 401) {
          disconnect();
          throw new Error('Sai mật khẩu Dashboard hoặc chưa cấu hình DASHBOARD_PASSWORD trong Netlify.');
        }
        throw new Error(data.error || `Không thể lấy dữ liệu (HTTP ${r.status}).`);
      }
      if (!Array.isArray(data.orders) || !Array.isArray(data.order_items) || !Array.isArray(data.books)) {
        throw new Error('Định dạng dữ liệu trả về không hợp lệ.');
      }
      applyPayload(data);
      status('Đã kết nối · tự cập nhật mỗi 30 giây', 'ok');
    } catch (err) {
      status('Lỗi kết nối · dữ liệu trước đó được giữ lại', 'bad');
      setMsg('Chưa thể đồng bộ: ' + (err?.name === 'AbortError' ? 'Quá thời gian kết nối.' : err.message), 'error');
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }
  function connect() {
    const p = $('livePassword').value;
    if (!p) { status('Hãy nhập mật khẩu Dashboard', 'bad'); return; }
    password = p;
    $('livePassword').value = '';
    $('refreshBtn').disabled = false;
    $('disconnectBtn').disabled = false;
    stop();
    loadLive();
    intervalId = setInterval(loadLive, 30000);
  }
  $('connectBtn').addEventListener('click', connect);
  $('livePassword').addEventListener('keydown', e=>{if(e.key==='Enter') connect();});
  $('refreshBtn').addEventListener('click', loadLive);
  $('disconnectBtn').addEventListener('click', disconnect);
  document.addEventListener('visibilitychange', () => {if(document.visibilityState==='visible'&&password)loadLive();});
  window.addEventListener('pagehide', stop);
  if (location.protocol === 'file:') {
    status('Bản HTML mở trên máy không thể tự đồng bộ; hãy triển khai lên Netlify', 'bad');
  }
})();
