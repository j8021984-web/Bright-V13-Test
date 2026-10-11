(()=>{'use strict';
const $=id=>document.getElementById(id), cfg=window.BEAUTY_CONFIG||{}, $all=s=>Array.from(document.querySelectorAll(s));
const state={db:null,admin:false,mode:'customer',tab:'requests',services:[],staff:[],bookings:[],openWindows:[],selected:new Date(),calMode:'month',edit:null,line:{inClient:false,ready:false,idToken:null,displayName:null}};
const pad=n=>String(n).padStart(2,'0'),dateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,atLocal=iso=>new Date(iso).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),dayLocal=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function msg(s,error=false){$('notice').textContent=s;$('notice').classList.toggle('error',error);$('notice').classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'});}
function clearMsg(){$('notice').classList.add('hidden');}
async function call(q){const {data,error}=await q;if(error)throw error;return data;}
function fail(e){console.error(e);msg(e.message||'操作失敗，請稍後再試',true);}
function serviceName(id){return state.services.find(x=>x.id===id)?.name||'已移除服務';}
function switchMode(mode){state.mode=mode;clearMsg();$('customerView').classList.toggle('hidden',mode!=='customer');$('adminView').classList.toggle('hidden',mode!=='admin');$('switchMode').textContent=mode==='customer'?'店家登入':'顧客預約';if(mode==='admin')syncAuth();}
const calState={month:new Date(),request:0};
function bookingDate(){return $('bookDate').value;}
function customerCalendar(){
 const m=calState.month, y=m.getFullYear(), mo=m.getMonth(), first=new Date(y,mo,1), offset=first.getDay(), count=new Date(y,mo+1,0).getDate();
 $('custMonth').textContent=`${y} 年 ${mo+1} 月`;
 const today=dateKey(new Date()), max=new Date();max.setDate(max.getDate()+90);
 let out=['日','一','二','三','四','五','六'].map(w=>`<span class="weekday">${w}</span>`).join('');
 for(let i=0;i<offset;i++)out+='<span></span>';
 for(let d=1;d<=count;d++){const key=`${y}-${pad(mo+1)}-${pad(d)}`, disabled=key<today||key>dateKey(max);out+=`<button type="button" class="cust-day ${key===bookingDate()?'active':''}" data-cust-date="${key}" ${disabled?'disabled':''}>${d}</button>`;}
 $('custCalendar').innerHTML=out;
 $('custDayLabel').textContent=bookingDate()?`${bookingDate()} 可預約時間`:'請先選擇日期';
}
async function loadPublic(){state.services=await call(state.db.from('services').select('*').eq('active',true).order('category').order('name'));const sel=$('bookService');sel.innerHTML='<option value="">請選擇服務</option>'+state.services.map(s=>`<option value="${esc(s.id)}">${esc(s.category)}｜${esc(s.name)}</option>`).join('');customerCalendar();await loadTimes();}
async function loadTimes(){
 const request=++calState.request,s=state.services.find(x=>x.id===$('bookService').value),day=bookingDate(),slots=$('custSlots');
 $('bookTime').value='';$('custSelected').textContent='請選擇可預約的時間。';
 $('serviceInfo').textContent=s?`預估 ${s.duration_minutes} 分鐘｜NT$ ${Number(s.price).toLocaleString()}`:'';
 if(!s||!day){slots.innerHTML='<p class="hint">請先選擇服務與日期。</p>';return;}
 slots.innerHTML='<p class="hint">正在讀取空閒時段…</p>';
 try{
  const [busy,windows]=await Promise.all([
   call(state.db.rpc('get_busy_slots',{p_day:day})),
   call(state.db.rpc('get_open_windows',{p_day:day}))
  ]);if(request!==calState.request)return;
  let out='';let available=0;
  // V1.3.1：資料庫每筆代表一個指定開始時間，不再自動切成 30 分鐘區間。
  for(const window of windows||[]){
   const t=String(window.start_time||'').slice(0,5);
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))continue;
   const start=new Date(`${day}T${t}:00+08:00`);
   const end=new Date(start.getTime()+s.duration_minutes*60000);
   const tooSoon=start.getTime()<Date.now()+3600000;
   const taken=(busy||[]).some(b=>start<new Date(b.end_at)&&end>new Date(b.start_at));
   const disabled=tooSoon||taken;
   if(!disabled)available++;
   out+=`<button type="button" class="time-choice" data-cust-time="${t}" ${disabled?'disabled':''}>${t}<small>${disabled?'不可預約':'可預約'}</small></button>`;
  }
  slots.innerHTML=out+(available?'':'<p class="hint">這一天沒有可預約的時段，請選擇其他日期。</p>');
 }catch(e){if(request!==calState.request)return;slots.innerHTML='<p class="hint">無法取得時段，請稍後重試。</p>';fail(e);}
}
async function initLine(){
 const el=$('lineIdentity');if(!el)return;
 if(!cfg.liffId||!window.liff){el.textContent='一般網頁預約：請填寫姓名與電話。LINE 身分尚未啟用。';return;}
 try{
  await window.liff.init({liffId:cfg.liffId});
  state.line.inClient=window.liff.isInClient();
  if(!window.liff.isLoggedIn()){
   el.textContent='請使用 LINE 登入後再預約。';
   if(state.line.inClient){window.liff.login();return;}
   // 一般瀏覽器不強制跳轉，保留原有公開預約功能。
   el.textContent='一般網頁預約：可填寫姓名與電話；若要綁定 LINE，請從 LIFF 網址開啟。';return;
  }
  state.line.idToken=window.liff.getIDToken();
  if(!state.line.idToken)throw Error('LINE 未提供身分憑證');
  state.line.ready=true;
  const profile=await window.liff.getProfile();state.line.displayName=profile.displayName;
  el.textContent='已透過 LINE 登入：'+profile.displayName+'（預約仍需填寫姓名及電話）';
 }catch(err){console.error('LIFF:',err);el.textContent='LINE 身分驗證尚未完成，請重新從 LIFF 網址開啟。';state.line.ready=false;state.line.idToken=null;}
}
async function submitLineBooking(payload){
 const response=await fetch(cfg.supabaseUrl+'/functions/v1/line-booking',{
  method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.supabaseAnonKey},
  body:JSON.stringify({...payload,id_token:state.line.idToken})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'LINE 預約送出失敗');
 return result.booking_id;
}
async function submitBooking(e){e.preventDefault();const s=$('bookService').value,day=bookingDate(),t=$('bookTime').value;if(!s||!day||!t)return msg('請選擇服務、日期及時間',true);try{const payload={p_service_id:s,p_name:$('bookName').value.trim(),p_phone:$('bookPhone').value.trim(),p_note:$('bookNote').value.trim(),p_start:new Date(`${day}T${t}:00+08:00`).toISOString()};if(state.line.inClient&&!state.line.ready)throw Error('LINE 身分尚未驗證，請重新開啟 LIFF 預約網址');const id=state.line.ready?await submitLineBooking(payload):await call(state.db.rpc('request_booking',payload));$('bookingForm').reset();$('bookDate').value=dateKey(new Date());calState.month=new Date();customerCalendar();await loadTimes();msg(`申請已送出！請等待店家審核。申請編號：${id.slice(0,8)}（請自行保存）`);}catch(e){fail(e);}}
async function syncAuth(){if(!state.db)return;try{const {data:{user}}=await state.db.auth.getUser();state.admin=user?await call(state.db.rpc('is_studio_admin')):false;$('loginPanel').classList.toggle('hidden',state.admin);$('dashboard').classList.toggle('hidden',!state.admin);if(state.admin)await loadAdmin();else if(user)msg('帳號已登入，但尚未被授權為工作室管理員。請依 README 設定 admin_users。',true);}catch(e){fail(e);}}
async function login(e) {
  e.preventDefault();

  try {
    if (!state.db || !state.db.auth) {
      throw new Error(
        'Supabase 尚未初始化，請重新整理頁面後再試'
      );
    }

    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;

    const { data, error } =
      await state.db.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    if (!data.user) {
      throw new Error('登入失敗，請重新嘗試');
    }

    await syncAuth();

  } catch (error) {
    fail(error);
  }
}
async function loadAdmin(){if(!state.admin)return;try{const [services,staff,bookings,openWindows]=await Promise.all([call(state.db.from('services').select('*').order('category').order('name')),call(state.db.from('staff').select('*').order('name')),call(state.db.from('bookings').select('*').order('start_at',{ascending:true})),call(state.db.from('booking_open_times').select('*').gte('day',dateKey(new Date())).order('day').order('start_time'))]);Object.assign(state,{services,staff,bookings,openWindows});renderAll();}catch(e){fail(e);}}
function renderAll(){renderRequests();renderCalendar();renderServices();renderStaff();renderCustomers();renderOpenWindows();}
function showTab(tab){state.tab=tab;$all('#adminTabs button').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));$all('.tab').forEach(p=>p.classList.toggle('hidden',p.id!==tab+'Tab'));if(tab==='calendar')renderCalendar();}
function renderRequests(){const list=state.bookings.filter(b=>b.status==='pending');$('pendingCount').textContent=`(${list.length})`;$('requestsList').innerHTML=list.length?list.map(b=>`<div class="item"><div><strong>${esc(b.customer_name)} · ${esc(serviceName(b.service_id))}</strong><small>${esc(atLocal(b.start_at))}｜${esc(b.customer_phone)}</small><small>${esc(b.note)}</small></div><div class="inline"><button class="primary" data-action="approve" data-id="${b.id}">核准</button><button class="outline" data-action="reject" data-id="${b.id}">拒絕</button></div></div>`).join(''):'<p class="hint">目前沒有待審核申請。</p>';}
async function review(id,status){const b=state.bookings.find(x=>x.id===id);if(!b)return;if(!confirm(`確定${status==='approved'?'核准':'拒絕'} ${b.customer_name} 的預約？`))return;try{await call(state.db.from('bookings').update({status}).eq('id',id).eq('status','pending'));await loadAdmin();msg(status==='approved'?'已核准並加入行事曆':'已拒絕申請');}catch(e){fail(e);}}
function moveDate(amount){const d=new Date(state.selected);d.setDate(d.getDate()+amount*7);state.selected=d;renderCalendar();}
function weekStart(date){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);d.setDate(d.getDate()-d.getDay());return d;}
function bookingStatusText(status){return ({approved:'已核准',pending:'待審核',rejected:'已拒絕',cancelled:'已取消',completed:'已完成'})[status]||status;}
function bookingStatusClass(status){return ['approved','pending','rejected','cancelled','completed'].includes(status)?status:'other';}
function calendarBookings(day){return state.bookings.filter(b=>dayLocal(b.start_at)===day).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));}
function renderCalendar(){
 const selected=state.selected,key=dateKey(selected),start=weekStart(selected);
 const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d;});
 const last=days[6];
 $('periodLabel').textContent=`${start.getFullYear()}/${pad(start.getMonth()+1)}/${pad(start.getDate())} – ${last.getFullYear()}/${pad(last.getMonth()+1)}/${pad(last.getDate())}`;
 const weekdays=['日','一','二','三','四','五','六'];
 $('calendarGrid').innerHTML='<div class="week-strip">'+days.map((d,i)=>{
  const k=dateKey(d),items=calendarBookings(k),active=items.filter(b=>['pending','approved'].includes(b.status));
  const pending=active.some(b=>b.status==='pending');
  return `<button type="button" class="week-day ${k===key?'active':''}" data-date="${k}" aria-pressed="${k===key}" aria-label="${k}，${active.length} 筆預約"><span class="week-name">${weekdays[i]}</span><strong>${d.getDate()}</strong><small>${active.length?active.length+' 筆':'無'}</small>${pending?'<i class="pending-dot" aria-label="有待審核預約"></i>':''}</button>`;
 }).join('')+'</div>';
 const items=calendarBookings(key);
 $('dayBookingsTitle').textContent=`${key}（${weekdays[selected.getDay()]}）預約清單 · ${items.length} 筆`;
 $('dayBookings').innerHTML=items.length?items.map(b=>`<div class="slot booking-${bookingStatusClass(b.status)}">
 <div class="bar"><strong>${esc(atLocal(b.start_at).slice(-5))} · ${esc(serviceName(b.service_id))}</strong><span class="booking-badge ${bookingStatusClass(b.status)}">${bookingStatusText(b.status)}</span></div>
 <small>${esc(b.customer_name)}｜${esc(b.customer_phone)}</small>${b.note?`<small>備註：${esc(b.note)}</small>`:''}
 <div class="inline booking-actions"><button type="button" class="outline" data-action="editBooking" data-id="${esc(b.id)}">查看／修改</button>
 ${b.status==='pending'?`<button type="button" class="primary" data-action="approve" data-id="${esc(b.id)}">核准</button><button type="button" class="outline" data-action="reject" data-id="${esc(b.id)}">拒絕</button>`:''}
 ${['pending','approved'].includes(b.status)?`<button type="button" class="danger" data-action="cancel" data-id="${esc(b.id)}">取消預約</button>`:''}</div></div>`).join(''):'<p class="hint empty-day">當天沒有預約。可按下方按鈕手動新增。</p>';
}
function renderServices(){$('servicesList').innerHTML=state.services.map(s=>`<div class="item"><div><strong>${esc(s.category)}｜${esc(s.name)}</strong><small>${s.duration_minutes} 分鐘 · NT$ ${Number(s.price).toLocaleString()} · ${s.active?'上架':'下架'}</small></div><button class="outline" data-action="editService" data-id="${s.id}">編輯</button></div>`).join('');}
function renderStaff(){$('staffList').innerHTML=state.staff.map(s=>`<div class="item"><div><strong>${esc(s.name)}</strong><small>${s.active?'在職':'停用'}</small></div><button class="outline" data-action="editStaff" data-id="${s.id}">編輯</button></div>`).join('');}
function renderOpenWindows(){
 const list=$('openWindowsList');if(!list)return;
 list.innerHTML=state.openWindows.length?state.openWindows.map(w=>`<div class="item"><div><strong>${esc(w.day)}｜${esc(String(w.start_time).slice(0,5))}</strong></div><button type="button" class="danger" data-action="removeWindow" data-id="${esc(w.id)}">刪除</button></div>`).join(''):'<p class="hint">尚未開放時段，顧客目前無法預約。</p>';
}
function setupManualTimes(){
 const form=$('openWindowForm');if(!form)return;
 // 不需更動 index.html：直接將舊的時間區間表單換成指定時間表單。
 form.innerHTML=`<label>開放日期<input id="openDay" type="date" required></label><label>指定開始時間<input id="openStart" type="time" step="60" required></label><button type="submit" class="primary">＋ 新增這個時間</button>`;
 $('openDay').min=dateKey(new Date());$('openDay').value=dateKey(new Date());
 const heading=form.closest('section, .card, article');
 if(heading){const h=heading.querySelector('h2,h3');if(h)h.textContent='自行指定可預約時間';}
}
async function addWindow(e){
 e.preventDefault();
 const day=$('openDay').value,start=$('openStart').value;
 if(!day||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))return msg('請選擇日期並輸入正確時間',true);
 if(day<dateKey(new Date()))return msg('不能新增過去日期',true);
 try{
  await call(state.db.from('booking_open_times').insert({day,start_time:start}));
  await loadAdmin();msg(`已開放 ${day} ${start}`);
 }catch(e){if(e.code==='23505')msg('這個日期與時間已經新增過了',true);else fail(e);}
}
async function removeWindow(id){
 if(!confirm('確定移除這個可預約時間？既有預約不會被取消。'))return;
 try{await call(state.db.from('booking_open_times').delete().eq('id',id));await loadAdmin();msg('已移除開放時間');}catch(e){fail(e);}
}
function renderCustomers(){const byPhone=new Map();state.bookings.forEach(b=>{const x=byPhone.get(b.customer_phone)||{name:b.customer_name,phone:b.customer_phone,count:0,last:''};x.count++;if(b.start_at>x.last)x.last=b.start_at;byPhone.set(b.customer_phone,x);});$('customersList').innerHTML=[...byPhone.values()].map(x=>`<div class="item"><div><strong>${esc(x.name)}</strong><small>${esc(x.phone)}｜${x.count} 筆申請｜最近 ${esc(atLocal(x.last))}</small></div></div>`).join('')||'<p class="hint">尚無顧客紀錄</p>';}
function field(label,name,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function openEdit(kind,id=null){const obj=kind==='service'?state.services.find(x=>x.id===id):kind==='staff'?state.staff.find(x=>x.id===id):state.bookings.find(x=>x.id===id);state.edit={kind,id};$('editTitle').textContent=({service:'服務項目',staff:'員工',booking:'預約'})[kind]+(id?'編輯':'新增');$('deleteEdit').classList.toggle('hidden',!id||kind==='booking');let html='';if(kind==='service')html=`<label>類別<select name="category">${['美甲','美睫','紋繡'].map(c=>`<option ${obj?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>`+field('名稱','name','text',obj?.name,'required maxlength="100"')+field('時間（分鐘）','duration_minutes','number',obj?.duration_minutes||60,'required min="15" max="480" step="15"')+field('價格（元）','price','number',obj?.price||0,'required min="0"')+`<label>上架<select name="active"><option value="true" ${obj?.active!==false?'selected':''}>是</option><option value="false" ${obj?.active===false?'selected':''}>否</option></select></label>`;
if(kind==='staff')html=field('員工姓名','name','text',obj?.name,'required maxlength="100"')+`<label>在職<select name="active"><option value="true" ${obj?.active!==false?'selected':''}>是</option><option value="false" ${obj?.active===false?'selected':''}>否</option></select></label>`;
if(kind==='booking'){const local=obj?new Date(obj.start_at):new Date(state.selected);html=`<label>服務<select name="service_id" required>${state.services.filter(s=>s.active||s.id===obj?.service_id).map(s=>`<option value="${s.id}" ${obj?.service_id===s.id?'selected':''}>${esc(s.category)}｜${esc(s.name)}</option>`).join('')}</select></label>`+field('顧客姓名','customer_name','text',obj?.customer_name,'required')+field('電話','customer_phone','tel',obj?.customer_phone,'required')+field('日期','day','date',obj?dayLocal(obj.start_at):dateKey(local),'required')+field('開始時間','time','time',obj?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(obj.start_at)):'10:00','required')+`<label>狀態<select name="status">${['approved','pending','rejected','cancelled'].map(v=>`<option value="${v}" ${obj?.status===v?'selected':''}>${{approved:'已核准',pending:'待審核',rejected:'已拒絕',cancelled:'已取消'}[v]}</option>`).join('')}</select></label>`+`<label>備註<textarea name="note" maxlength="500">${esc(obj?.note||'')}</textarea></label>`;}
$('editFields').innerHTML=html;$('editDialog').showModal();}
async function saveEdit(e){e.preventDefault();const {kind,id}=state.edit,f=new FormData($('editForm'));try{let table,payload;if(kind==='service'){table='services';payload={category:f.get('category'),name:f.get('name').trim(),duration_minutes:Number(f.get('duration_minutes')),price:Number(f.get('price')),active:f.get('active')==='true'};}else if(kind==='staff'){table='staff';payload={name:f.get('name').trim(),active:f.get('active')==='true'};}else{table='bookings';const service=state.services.find(s=>s.id===f.get('service_id'));if(!service)throw Error('服務不存在');const start=new Date(`${f.get('day')}T${f.get('time')}:00+08:00`);payload={service_id:service.id,customer_name:f.get('customer_name').trim(),customer_phone:f.get('customer_phone').trim(),start_at:start.toISOString(),end_at:new Date(start.getTime()+service.duration_minutes*60000).toISOString(),status:f.get('status'),note:f.get('note')||''};}
if(kind==='booking'&&['pending','approved'].includes(payload.status)){
 const overlapping=state.bookings.find(b=>b.id!==id&&['pending','approved'].includes(b.status)&&new Date(b.start_at)<new Date(payload.end_at)&&new Date(b.end_at)>new Date(payload.start_at));
 if(overlapping)throw Error(`預約時間衝突：${overlapping.customer_name}（${atLocal(overlapping.start_at)}），請選其他時間`);
}
await call(id?state.db.from(table).update(payload).eq('id',id):state.db.from(table).insert(payload));$('editDialog').close();await loadAdmin();msg('儲存成功');}catch(e){fail(e);}}
async function deleteEdit(){const {kind,id}=state.edit;if(!id||!confirm('確定永久刪除此項目？'))return;try{await call(state.db.from(kind==='service'?'services':'staff').delete().eq('id',id));$('editDialog').close();await loadAdmin();msg('已刪除');}catch(e){fail(e);}}
async function cancelBooking(id){if(!confirm('確定取消此預約？'))return;try{await call(state.db.from('bookings').update({status:'cancelled'}).eq('id',id));await loadAdmin();msg('預約已取消');}catch(e){fail(e);}}
function bind(){ setupManualTimes();$('openWindowForm').onsubmit=addWindow; $('switchMode').onclick=()=>switchMode(state.mode==='customer'?'admin':'customer');$('bookService').onchange=loadTimes;$('custPrev').onclick=()=>{calState.month=new Date(calState.month.getFullYear(),calState.month.getMonth()-1,1);customerCalendar();};$('custNext').onclick=()=>{calState.month=new Date(calState.month.getFullYear(),calState.month.getMonth()+1,1);customerCalendar();};$('bookingForm').onsubmit=submitBooking;$('loginForm').onsubmit=login;$('logoutBtn').onclick=async()=>{await state.db.auth.signOut();state.admin=false;await syncAuth();};$all('#adminTabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('prevPeriod').onclick=()=>moveDate(-1);$('nextPeriod').onclick=()=>moveDate(1);$('todayBtn').onclick=()=>{state.selected=new Date();renderCalendar();};$('addBooking').onclick=()=>openEdit('booking');$('addService').onclick=()=>openEdit('service');$('addStaff').onclick=()=>openEdit('staff');$('editForm').onsubmit=saveEdit;$('deleteEdit').onclick=deleteEdit;$('closeDialog').onclick=()=>$('editDialog').close();$('copyUrl').onclick=async()=>{try{await navigator.clipboard.writeText(location.href.split('#')[0].split('?')[0]);msg('已複製預約網址');}catch{msg('請手動複製網址列',true);}};document.addEventListener('click',e=>{const cd=e.target.closest('[data-cust-date]');if(cd){$('bookDate').value=cd.dataset.custDate;customerCalendar();loadTimes();return;}const ct=e.target.closest('[data-cust-time]');if(ct&&!ct.disabled){$('bookTime').value=ct.dataset.custTime;$all('.time-choice').forEach(x=>x.classList.toggle('active',x===ct));$('custSelected').textContent=`已選擇：${bookingDate()} ${ct.dataset.custTime}`;return;}const date=e.target.closest('[data-date]');if(date){state.selected=new Date(date.dataset.date+'T12:00:00');renderCalendar();return;}const b=e.target.closest('[data-action]');if(!b)return;const {action,id}=b.dataset;if(action==='removeWindow')removeWindow(id);if(action==='approve')review(id,'approved');if(action==='reject')review(id,'rejected');if(action==='cancel')cancelBooking(id);if(action==='editService')openEdit('service',id);if(action==='editStaff')openEdit('staff',id);if(action==='editBooking')openEdit('booking',id);});}
async function init(){bind();$('studioName').textContent=cfg.studioName||'美業預約管家';$('publicUrl').textContent=location.href.split('?')[0].split('#')[0];if(cfg.lineOfficialUrl){$('lineLink').href=cfg.lineOfficialUrl;$('lineLink').classList.remove('hidden');}const now=new Date();$('bookDate').min=dateKey(now);const max=new Date(now);max.setDate(max.getDate()+90);$('bookDate').max=dateKey(max);$('bookDate').value=dateKey(now);if(!cfg.supabaseUrl||!cfg.supabaseAnonKey){msg('尚未設定 Supabase。請依 README 設定 config.js 後重新部署，才能使用真實預約。',true);$('bookingForm').querySelector('button[type=submit]').disabled=true;return;}if(!window.supabase){msg('Supabase 套件載入失敗，請檢查網路連線。',true);return;}state.db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);try{await loadPublic();}catch(e){fail(e);}await initLine();if(new URLSearchParams(location.search).get('admin')==='1')switchMode('admin');}
init();})();
