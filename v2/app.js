(()=>{'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let learning='th',translation='he',toastTimer,editingDraftId=null,supabaseClient=null,schemaReady=false,currentUser=null,drafts=[],learnerProfile=null,learningItems=[],learningType='word',quizItems=[],quizIndex=0,quizCorrect=0,quizAnswered=false,lastDurationFlush=Date.now(),syncingOfflineQueue=false;
const languageNames={he:'עברית',en:'אנגלית',th:'תאית'};
const LOCAL_PREFIX='lingua-v2:';
function readLocal(key,fallback){try{const value=localStorage.getItem(LOCAL_PREFIX+key);return value?JSON.parse(value):fallback}catch{return fallback}}
function writeLocal(key,value){try{localStorage.setItem(LOCAL_PREFIX+key,JSON.stringify(value));return true}catch(e){console.warn('Local storage unavailable',e);return false}}
function progressQueueKey(){return 'queue:'+currentUser?.id}
async function syncOfflineQueue(){if(!currentUser||!supabaseClient||!navigator.onLine||syncingOfflineQueue)return;syncingOfflineQueue=true;try{const key=progressQueueKey(),queue=readLocal(key,[]),remaining=[];for(const row of queue){try{const {data:remote,error:readError}=await supabaseClient.from('user_progress').select('mastery,times_seen,times_correct,last_seen_at,updated_at').eq('user_id',row.user_id).eq('content_item_id',row.content_item_id).maybeSingle();if(readError)throw readError;const merged={...row,mastery:Math.max(row.mastery||0,remote?.mastery||0),times_seen:Math.max(row.times_seen||0,remote?.times_seen||0),times_correct:Math.max(row.times_correct||0,remote?.times_correct||0),last_seen_at:[row.last_seen_at,remote?.last_seen_at].filter(Boolean).sort().at(-1)||null,updated_at:new Date().toISOString()};const {error}=await supabaseClient.from('user_progress').upsert(merged,{onConflict:'user_id,content_item_id'});if(error)throw error;const local=readLocal('progress:'+currentUser.id,{});local[row.content_item_id]=merged;writeLocal('progress:'+currentUser.id,local)}catch(e){remaining.push(row);console.warn('Offline progress sync deferred',e.message)}}writeLocal(key,remaining);const testKey='test-queue:'+currentUser.id,testQueue=readLocal(testKey,[]),testRemaining=[];for(const result of testQueue){try{const {error}=await supabaseClient.from('test_results').insert(result);if(error&&error.code!=='23505')throw error}catch(e){testRemaining.push(result);console.warn('Offline test sync deferred',e.message)}}writeLocal(testKey,testRemaining);if((queue.length&&!remaining.length)||(testQueue.length&&!testRemaining.length)){toast('ההתקדמות ותוצאות המבחנים סונכרנו.');await refreshLearnerStats();await loadAchievements()}}finally{syncingOfflineQueue=false}}
window.addEventListener('online',()=>syncOfflineQueue());
function toast(message){const el=$('#toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5200)}
function setView(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));['register','login','admin','learner'].forEach(v=>$('#'+v+'View')?.classList.toggle('hidden',v!==name));if(name==='admin')refreshAdmin();if(name==='learner')loadLearning(learningType)}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function setConnection(message,good=false){const el=$('#connectionState');if(el){el.textContent=message;el.className='connection '+(good?'good':'wait')}}
function setupChoices(id,callback){const root=$('#'+id);root?.addEventListener('click',e=>{const b=e.target.closest('[data-lang]');if(!b)return;root.querySelectorAll('.choice').forEach(x=>x.classList.toggle('selected',x===b));callback(b.dataset.lang)})}
setupChoices('learningChoices',v=>learning=v);setupChoices('translationChoices',v=>translation=v);
async function init(){
 if(!window.supabase?.createClient||!window.LINGUA_SUPABASE_CONFIG){setConnection('ספריית החיבור לא נטענה');return}
 const {url,publishableKey}=window.LINGUA_SUPABASE_CONFIG;
 supabaseClient=window.supabase.createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 try{
  const {data:{session}}=await supabaseClient.auth.getSession();
  const {error}=await supabaseClient.from('profiles').select('id').limit(1);
  if(error){setConnection('אין חיבור למסד הנתונים · מצב לא מקוון');if(session){currentUser=session.user;if(!isOwner())await routeLearner()}else console.info('Database unavailable:',error.message)}
  else{schemaReady=true;setConnection('החיבור למסד הנתונים פעיל',true);if(session){currentUser=session.user;if(isOwner())setView('admin');else await routeLearner();await syncOfflineQueue()}}
  supabaseClient.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){currentUser=null;learnerProfile=null;setView('login')}});
 }catch(err){setConnection('לא ניתן לאמת את מסד הנתונים');console.error(err)}
}
function isOwner(){return currentUser?.app_metadata?.role==='owner_admin'}
async function routeLearner(){const {data:profile,error}=await supabaseClient.from('profiles').select('approval_status,display_name,learning_language,translation_language').eq('id',currentUser.id).maybeSingle();if(error||!profile){const cached=readLocal('profile:'+currentUser.id,null);if(cached?.approval_status==='approved'){learnerProfile=cached;learning=cached.learning_language;translation=cached.translation_language;$('#learnerLearning').value=learning;$('#learnerTranslation').value=translation;$('#learnerPair').textContent=(languageNames[learning]||learning)+' ← '+(languageNames[translation]||translation)+' · מצב לא מקוון';setView('learner');await refreshLearnerStats();await loadAchievements();await loadLearning(learningType);toast('מצב לא מקוון: תכנים שמורים והתקדמות תסונכרן בחיבור הבא.');return}toast('לא ניתן לאמת את אישור החשבון ללא חיבור.');return}if(profile.approval_status!=='approved'){toast('החשבון ממתין לאישור מנהל.');setView('login');return}writeLocal('profile:'+currentUser.id,profile);await enterLearner()}
async function callAdmin(payload){const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw new Error('יש להתחבר תחילה');const {data,error}=await supabaseClient.functions.invoke('admin',{body:payload});if(error)throw error;if(data?.error)throw new Error(data.error);return data}
async function logEvent(event_type,metadata={}){if(!currentUser||!schemaReady)return;try{await supabaseClient.from('learning_events').insert({user_id:currentUser.id,event_type,metadata})}catch(e){console.warn('Event log failed',e)}}
async function flushSessionDuration(){if(!currentUser||!schemaReady||document.visibilityState==='visible'&&Date.now()-lastDurationFlush<60000)return;const now=Date.now(),seconds=Math.floor((now-lastDurationFlush)/1000);if(seconds<15)return;lastDurationFlush=now;try{const {error}=await supabaseClient.from('learning_events').insert({user_id:currentUser.id,event_type:'study',duration_seconds:Math.min(seconds,3600),metadata:{kind:'active_session'}});if(error)console.warn('Session duration not saved',error)}catch(e){console.warn(e)}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushSessionDuration()});
window.addEventListener('pagehide',()=>{flushSessionDuration()});

async function refreshAdmin(){
 if(!supabaseClient||!schemaReady){$('#adminNotice').textContent='מסד הנתונים עדיין לא הותקן. פונקציות הניהול יפעלו לאחר התקנת המיגרציה ופריסת פונקציית השרת.';return}
 if(!isOwner()){$('#adminNotice').textContent='לוח הניהול זמין לבעל המערכת בלבד. התחבר עם חשבון המנהל.';return}
 try{const stats=await callAdmin({action:'dashboard_stats'});$('#statUsers').textContent=stats.users??0;$('#statPending').textContent=stats.pending??0;$('#statActivity').textContent=stats.activity_events_7d??0;$('#statContent').textContent=stats.published_content??0;$('#statAverage').textContent=stats.average_test_score===null?'—':Math.round(stats.average_test_score)+'%';$('#adminNotice').textContent='אימות מנהל הצליח. לוח הניהול מחובר.';await loadUsers();await loadDrafts()}
 catch(e){$('#adminNotice').textContent='אין אפשרות לטעון נתוני ניהול: '+e.message}
}
async function loadUsers(){if(!isOwner())return;try{const r=await callAdmin({action:'list_users'});const rows=r.profiles||[];const date=v=>v?new Date(v).toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'—';$('#usersTable').innerHTML=rows.length?'<table><thead><tr><th>שם</th><th>שפות</th><th>סטטוס</th><th>פעילות אחרונה</th><th>כניסה אחרונה</th><th>נלמדו</th><th>דקות למידה</th><th>מבחנים</th><th>ממוצע</th><th>פעולות</th></tr></thead><tbody>'+rows.map(p=>'<tr><td>'+escapeHtml(p.display_name)+'</td><td>'+escapeHtml(p.learning_language)+' ← '+escapeHtml(p.translation_language)+'</td><td>'+escapeHtml(p.approval_status)+'</td><td>'+date(p.last_active)+'</td><td>'+date(p.last_login)+'</td><td>'+p.learned_count+'</td><td>'+p.study_minutes+'</td><td>'+p.test_count+'</td><td>'+(p.average_test_score===null?'—':p.average_test_score+'%')+'</td><td>'+(p.approval_status==='pending'?'<button data-user="'+p.id+'" data-status="approved">אשר</button> <button data-user="'+p.id+'" data-status="rejected">דחה</button>':'<button data-user="'+p.id+'" data-status="suspended">השעיה</button>')+'</td></tr>').join('')+'</tbody></table>':'אין משתמשים להצגה';
 $('#usersTable').querySelectorAll('[data-user]').forEach(b=>b.addEventListener('click',async()=>{try{await callAdmin({action:'set_approval',user_id:b.dataset.user,status:b.dataset.status});toast('סטטוס המשתמש עודכן');await refreshAdmin()}catch(e){toast(e.message)}}))
 }catch(e){$('#usersTable').textContent='לא ניתן לטעון משתמשים: '+e.message}}
async function loadDrafts(){
 if(!isOwner()||!supabaseClient)return;
 try{
  const {data,error}=await supabaseClient.from('content_items').select('id,source_text,translation_text,transliteration,item_type,category,learning_language,translation_language,status').eq('status','draft').order('created_at',{ascending:false}).limit(100);
  if(error)throw error;drafts=data||[];
  $('#draftsTable').innerHTML=drafts.length?'<table><thead><tr><th></th><th>תוכן</th><th>תרגום</th><th>שפות</th><th>עריכה</th></tr></thead><tbody>'+drafts.map(d=>'<tr><td><input type="checkbox" data-draft="'+d.id+'"></td><td>'+escapeHtml(d.source_text)+'</td><td>'+escapeHtml(d.translation_text)+'</td><td>'+escapeHtml(d.learning_language)+' → '+escapeHtml(d.translation_language)+'</td><td><button data-edit-draft="'+d.id+'">ערוך</button></td></tr>').join('')+'</tbody></table>':'אין טיוטות כרגע';
  $('#draftsTable').querySelectorAll('[data-edit-draft]').forEach(b=>b.addEventListener('click',()=>{const d=drafts.find(x=>x.id===b.dataset.editDraft);if(!d)return;editingDraftId=d.id;$('#contentLearning').value=d.learning_language;$('#contentTranslation').value=d.translation_language;$('#contentType').value=d.item_type;$('#contentCategory').value=d.category||'general';$('#contentSource').value=d.source_text;$('#contentTranslationText').value=d.translation_text;$('#contentTransliteration').value=d.transliteration||'';$('#saveDraft').textContent='עדכן טיוטה';$('#contentSource').scrollIntoView({behavior:'smooth',block:'center'});toast('הטיוטה נטענה לעריכה')}));
 }catch(e){$('#draftsTable').textContent='לא ניתן לטעון טיוטות: '+e.message}
}
async function enterLearner(){
 const {data:profile,error}=await supabaseClient.from('profiles').select('display_name,learning_language,translation_language,approval_status').eq('id',currentUser.id).single();
 if(error||!profile||profile.approval_status!=='approved'){toast('החשבון אינו מאושר ללמידה.');return}
 learnerProfile=profile;learning=profile.learning_language;translation=profile.translation_language;$('#learnerLearning').value=learning;$('#learnerTranslation').value=translation;
 $('#learnerPair').textContent=(languageNames[learning]||learning)+' ← '+(languageNames[translation]||translation);
 setView('learner');await refreshLearnerStats();await loadAchievements();lastDurationFlush=Date.now();await logEvent('login',{client:'web'});
}
async function loadAchievements(){const root=$('#achievementsList');if(!root||!currentUser)return;try{const {data,error}=await supabaseClient.from('user_achievements').select('achievement_key,title,description,awarded_at').eq('user_id',currentUser.id).order('awarded_at',{ascending:false}).limit(100);if(error)throw error;root.innerHTML=data?.length?'<ul>'+data.map(x=>'<li><b>'+escapeHtml(x.title)+'</b> — '+escapeHtml(x.description||'')+'</li>').join('')+'</ul>':'עדיין אין הישגים. הם יתווספו ככל שתתקדם בלמידה.'}catch(e){root.textContent='לא ניתן לטעון הישגים: '+e.message}}
async function refreshLearnerStats(){
 if(!currentUser)return;
 let progressRows=[],testRows=[];
 if(navigator.onLine&&supabaseClient){
  const [progress,tests]=await Promise.all([
   supabaseClient.from('user_progress').select('content_item_id,mastery').eq('user_id',currentUser.id),
   supabaseClient.from('test_results').select('score,completed_at').eq('user_id',currentUser.id).order('completed_at',{ascending:false}).limit(100)
  ]);
  if(!progress.error)progressRows=progress.data||[];else console.warn(progress.error);
  if(!tests.error)testRows=tests.data||[];else console.warn(tests.error);
  if(!progress.error)writeLocal('progress:'+currentUser.id,Object.fromEntries(progressRows.map(x=>[x.content_item_id,x])));
  if(!tests.error)writeLocal('tests:'+currentUser.id,testRows);
 }
 const localProgress=Object.values(readLocal('progress:'+currentUser.id,{}));
 const progressById=new Map(progressRows.map(x=>[x.content_item_id,x]));
 for(const row of localProgress){const remote=progressById.get(row.content_item_id);if(!remote||new Date(row.updated_at||0)>new Date(remote.updated_at||0))progressById.set(row.content_item_id,row)}
 progressRows=[...progressById.values()];
 const localTests=readLocal('tests:'+currentUser.id,[]);
 const pendingTests=readLocal('test-queue:'+currentUser.id,[]);
 const testsById=new Map([...testRows,...localTests,...pendingTests].map(x=>[x.id||[x.completed_at,x.score,x.question_count].join(':'),x]));
 testRows=[...testsById.values()].sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at));
 const mastered=progressRows.filter(x=>x.mastery>=3).length;
 $('#learnedCount').textContent=mastered;$('#testCount').textContent=testRows.length;$('#lastScore').textContent=testRows.length?Math.round(Number(testRows[0].score))+'%':'—';
}
async function loadLearning(type='word'){
 if(!supabaseClient||!currentUser||!learnerProfile)return;
 learningType=type;$('#learningNotice').textContent='טוען תכנים...';$('#learningList').innerHTML='';
 const {data,error}=await supabaseClient.from('content_items').select('id,source_text,translation_text,transliteration,category,item_type').eq('status','published').eq('learning_language',learning).eq('translation_language',translation).eq('item_type',type).order('category').limit(500);
 if(error){learningItems=readLocal('content:'+learning+':'+translation+':'+type,[]);if(learningItems.length)$('#learningNotice').textContent='מצב לא מקוון · מוצגים '+learningItems.length+' פריטים שמורים.';else{$('#learningNotice').textContent='אין תכנים שמורים במצב לא מקוון. התחבר לאינטרנט לטעינה ראשונה.';return}}else{learningItems=data||[];writeLocal('content:'+learning+':'+translation+':'+type,learningItems)}$('#availableCount').textContent=learningItems.length;
 if(!learningItems.length){$('#learningNotice').textContent='עדיין לא פורסמו '+(type==='word'?'מילים':'משפטים')+' בצמד השפות שבחרת. התוכן יופיע כאן לאחר פרסומו.';return}
 $('#learningNotice').textContent='נמצאו '+learningItems.length+' פריטים. לחץ על „תרגלתי” כדי לשמור התקדמות.';
 const {data:progress,error:progressError}=await supabaseClient.from('user_progress').select('content_item_id,mastery').eq('user_id',currentUser.id).in('content_item_id',learningItems.map(x=>x.id));
 const localProgress=readLocal('progress:'+currentUser.id,{});
 const mastered=new Map((progressError?Object.values(localProgress):(progress||[])).map(x=>[x.content_item_id,x.mastery]));
 $('#learningList').innerHTML=learningItems.map(item=>'<article class="learning-card"><div class="learning-card-copy"><small>'+escapeHtml(item.category||'כללי')+'</small><h3>'+escapeHtml(item.source_text)+'</h3><p>'+escapeHtml(item.translation_text)+'</p>'+(item.transliteration?'<small class="transliteration">'+escapeHtml(item.transliteration)+'</small>':'')+'</div><div class="learning-actions"><button class="secondary" data-speak="'+item.id+'">🔊 שמע</button><button class="secondary" data-learned="'+item.id+'">'+(mastered.get(item.id)>=3?'נלמד ✓':'תרגלתי')+'</button></div></article>').join('');
 $('#learningList').querySelectorAll('[data-speak]').forEach(b=>b.addEventListener('click',()=>speakItem(b.dataset.speak)));
 $('#learningList').querySelectorAll('[data-learned]').forEach(b=>b.addEventListener('click',()=>markLearned(b.dataset.learned,b)));
}
function speakItem(id){const item=learningItems.find(x=>x.id===id);if(!item||!('speechSynthesis'in window)){toast('הקראת טקסט אינה זמינה במכשיר הזה');return}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(item.source_text);u.lang=({th:'th-TH',he:'he-IL',en:'en-US'})[learning]||learning;speechSynthesis.speak(u)}
async function markLearned(id,button){
 const old=button.textContent;button.disabled=true;
 try{
  const key='progress:'+currentUser.id,local=readLocal(key,{});let existing=local[id]||null;
  if(navigator.onLine){const {data,error}=await supabaseClient.from('user_progress').select('mastery,times_seen,times_correct').eq('user_id',currentUser.id).eq('content_item_id',id).maybeSingle();if(error)throw error;existing=data||existing}
  const row={user_id:currentUser.id,content_item_id:id,mastery:Math.min(5,(existing?.mastery||0)+1),times_seen:(existing?.times_seen||0)+1,times_correct:existing?.times_correct||0,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  local[id]=row;writeLocal(key,local);
  if(!navigator.onLine){const q=readLocal(progressQueueKey(),[]).filter(x=>x.content_item_id!==id);q.push(row);writeLocal(progressQueueKey(),q);button.textContent='נשמר במכשיר ✓';toast('נשמר מקומית. הסנכרון יתבצע בחיבור הבא.');return}
  try{const {error}=await supabaseClient.from('user_progress').upsert(row,{onConflict:'user_id,content_item_id'});if(error)throw error;}
  catch(networkError){const q=readLocal(progressQueueKey(),[]).filter(x=>x.content_item_id!==id);q.push(row);writeLocal(progressQueueKey(),q);button.textContent='נשמר במכשיר ✓';toast('החיבור נכשל. ההתקדמות נשמרה במכשיר ותסונכרן בהמשך.');return}
  await logEvent('study',{content_item_id:id});try{await callAdmin({action:'sync_achievements'});await loadAchievements()}catch(achievementError){console.warn('Achievement sync deferred',achievementError)}button.textContent='נשמר ✓';await refreshLearnerStats()
 }catch(e){button.textContent=old;toast('שמירת ההתקדמות נכשלה: '+e.message)}finally{button.disabled=false}
}
function startQuiz(){
 if(learningItems.length<2){toast('נדרשים לפחות שני פריטים שפורסמו כדי להתחיל מבחן.');return}
 quizItems=shuffle(learningItems).slice(0,Math.min(10,learningItems.length));quizIndex=0;quizCorrect=0;quizAnswered=false;$('#quizPanel').classList.remove('hidden');renderQuestion();$('#quizPanel').scrollIntoView({behavior:'smooth',block:'center'})
}
function renderQuestion(){
 const item=quizItems[quizIndex];if(!item)return;quizAnswered=false;$('#quizFeedback').textContent='';$('#nextQuestion').classList.add('hidden');
 $('#quizQuestion').innerHTML='<p><small>שאלה '+(quizIndex+1)+' מתוך '+quizItems.length+'</small></p><h3>'+escapeHtml(item.source_text)+'</h3>';
 const choices=shuffle([item,...shuffle(learningItems.filter(x=>x.id!==item.id)).slice(0,Math.min(3,learningItems.length-1))]);
 $('#quizAnswers').innerHTML=choices.map(x=>'<button class="quiz-answer" data-answer="'+x.id+'">'+escapeHtml(x.translation_text)+'</button>').join('');
 $('#quizAnswers').querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>answerQuestion(b,item)))
}
async function answerQuestion(button,item){
 if(quizAnswered)return;quizAnswered=true;const correct=button.dataset.answer===item.id;if(correct)quizCorrect++;
 $('#quizAnswers').querySelectorAll('button').forEach(b=>{b.disabled=true;if(b.dataset.answer===item.id)b.classList.add('correct');else if(b===button)b.classList.add('incorrect')});
 $('#quizFeedback').textContent=correct?'נכון מאוד!':'לא מדויק. התשובה הנכונה: '+item.translation_text;
 if(correct){try{const key='progress:'+currentUser.id,local=readLocal(key,{});let existing=local[item.id]||null;if(navigator.onLine){const {data,error}=await supabaseClient.from('user_progress').select('mastery,times_seen,times_correct').eq('user_id',currentUser.id).eq('content_item_id',item.id).maybeSingle();if(error)throw error;existing=data||existing}const row={user_id:currentUser.id,content_item_id:item.id,mastery:Math.min(5,(existing?.mastery||0)+1),times_seen:(existing?.times_seen||0)+1,times_correct:(existing?.times_correct||0)+1,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};local[item.id]=row;writeLocal(key,local);if(!navigator.onLine){const q=readLocal(progressQueueKey(),[]).filter(x=>x.content_item_id!==item.id);q.push(row);writeLocal(progressQueueKey(),q)}else{const {error}=await supabaseClient.from('user_progress').upsert(row,{onConflict:'user_id,content_item_id'});if(error)throw error}}catch(e){console.warn('Quiz progress saved locally after sync error',e);const key='progress:'+currentUser.id,local=readLocal(key,{});const row=local[item.id]||{user_id:currentUser.id,content_item_id:item.id,mastery:1,times_seen:1,times_correct:1,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};local[item.id]=row;writeLocal(key,local);const q=readLocal(progressQueueKey(),[]).filter(x=>x.content_item_id!==item.id);q.push(row);writeLocal(progressQueueKey(),q)}}
 $('#nextQuestion').textContent=quizIndex===quizItems.length-1?'סיום המבחן':'השאלה הבאה';$('#nextQuestion').classList.remove('hidden')
}
async function nextQuiz(){
 if(!quizAnswered)return;quizIndex++;
 if(quizIndex<quizItems.length){renderQuestion();return}
 const score=Math.round(quizCorrect/quizItems.length*100),result={id:crypto.randomUUID(),user_id:currentUser.id,language_pair:learning+'-'+translation,score,question_count:quizItems.length,correct_count:quizCorrect,completed_at:new Date().toISOString()};
 try{if(navigator.onLine){const {error}=await supabaseClient.from('test_results').insert(result);if(error)throw error;await logEvent('test',{score,question_count:quizItems.length});try{await callAdmin({action:'sync_achievements'});await loadAchievements()}catch(achievementError){console.warn('Achievement sync deferred',achievementError)}}else{const q=readLocal('test-queue:'+currentUser.id,[]);q.push(result);writeLocal('test-queue:'+currentUser.id,q);const cached=readLocal('tests:'+currentUser.id,[]);writeLocal('tests:'+currentUser.id,[result,...cached])}$('#quizQuestion').innerHTML='<h3>המבחן הסתיים</h3><p>ענית נכון על '+quizCorrect+' מתוך '+quizItems.length+' שאלות — '+score+'%.</p>';$('#quizAnswers').innerHTML='';$('#quizFeedback').textContent=navigator.onLine?'התוצאה נשמרה בהתקדמות האישית שלך.':'התוצאה נשמרה במכשיר ותסונכרן בחיבור הבא.';$('#nextQuestion').classList.add('hidden');await refreshLearnerStats()}
 catch(e){const q=readLocal('test-queue:'+currentUser.id,[]);q.push(result);writeLocal('test-queue:'+currentUser.id,q);const cached=readLocal('tests:'+currentUser.id,[]);writeLocal('tests:'+currentUser.id,[result,...cached]);$('#quizFeedback').textContent='החיבור נכשל. תוצאת המבחן נשמרה במכשיר ותסונכרן בהמשך.';$('#nextQuestion').classList.add('hidden');await refreshLearnerStats()}
}
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const p=$('#password').value,p2=$('#password2').value;if(p!==p2){toast('הסיסמאות אינן תואמות.');return}if(learning===translation){toast('בחר שפת לימוד ושפת תרגום שונות.');return}if(!supabaseClient||!schemaReady){toast('מסד הנתונים טרם הותקן.');return}const btn=$('#registerForm button[type=submit]');btn.disabled=true;try{const {data,error}=await supabaseClient.auth.signUp({email:$('#email').value.trim(),password:p,options:{data:{display_name:$('#displayName').value.trim(),learning_language:learning,translation_language:translation}}});if(error)throw error;toast(data.session?'החשבון נוצר וממתין לאישור מנהל.':'נשלח אימייל אימות. לאחר האימות החשבון ימתין לאישור מנהל.')}catch(err){toast('הרשמה נכשלה: '+err.message)}finally{btn.disabled=false}});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!supabaseClient||!schemaReady){toast('מסד הנתונים טרם הותקן.');return}const f=$$('#loginForm input');try{const {data,error}=await supabaseClient.auth.signInWithPassword({email:f[0].value.trim(),password:f[1].value});if(error)throw error;currentUser=data.user;if(isOwner()){toast('התחברת כמנהל.');setView('admin');return}await routeLearner()}catch(err){toast('הכניסה נכשלה: '+err.message)}});
$('#saveLanguagePair')?.addEventListener('click',async()=>{const nextLearning=$('#learnerLearning').value,nextTranslation=$('#learnerTranslation').value;if(nextLearning===nextTranslation){toast('יש לבחור שתי שפות שונות.');return}const btn=$('#saveLanguagePair');btn.disabled=true;try{const {data,error}=await supabaseClient.from('profiles').update({learning_language:nextLearning,translation_language:nextTranslation}).eq('id',currentUser.id).select('learning_language,translation_language').single();if(error)throw error;learning=data.learning_language;translation=data.translation_language;learnerProfile={...learnerProfile,...data};$('#learnerPair').textContent=(languageNames[learning]||learning)+' ← '+(languageNames[translation]||translation);$('#quizPanel').classList.add('hidden');await loadLearning(learningType);toast('צמד השפות עודכן. ההתקדמות שלך נשמרה.')}catch(e){toast('עדכון השפות נכשל: '+e.message)}finally{btn.disabled=false}});
$('#loadAdmin')?.addEventListener('click',refreshAdmin);$('#loadUsers')?.addEventListener('click',loadUsers);$('#showWords')?.addEventListener('click',()=>loadLearning('word'));$('#showSentences')?.addEventListener('click',()=>loadLearning('sentence'));$('#startTest')?.addEventListener('click',startQuiz);$('#nextQuestion')?.addEventListener('click',nextQuiz);
$('#signOut')?.addEventListener('click',async()=>{await flushSessionDuration();await supabaseClient.auth.signOut();currentUser=null;learnerProfile=null;setView('login');toast('יצאת מהחשבון.')});
$('#saveDraft')?.addEventListener('click',async()=>{if($('#contentLearning').value===$('#contentTranslation').value){toast('שפת הלימוד והתרגום חייבות להיות שונות');return}try{await callAdmin({action:'save_content',id:editingDraftId||undefined,item:{learning_language:$('#contentLearning').value,translation_language:$('#contentTranslation').value,item_type:$('#contentType').value,category:$('#contentCategory').value,source_text:$('#contentSource').value,translation_text:$('#contentTranslationText').value,transliteration:$('#contentTransliteration').value}});toast('הטיוטה נשמרה');$('#contentSource').value='';$('#contentTranslationText').value='';$('#contentTransliteration').value='';editingDraftId=null;$('#saveDraft').textContent='שמור כטיוטה';await loadDrafts()}catch(e){toast('שמירת הטיוטה נכשלה: '+e.message)}});
$('#publishSelected')?.addEventListener('click',async()=>{const ids=$$('#draftsTable [data-draft]:checked').map(x=>x.dataset.draft);if(!ids.length){toast('בחר לפחות פריט אחד לפרסום');return}try{const r=await callAdmin({action:'publish_content',ids});toast('פורסמו '+r.published+' פריטים');await loadDrafts();await refreshAdmin()}catch(e){toast('הפרסום נכשל: '+e.message)}});
$$('.tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('#showAdmin')?.addEventListener('click',()=>setView('admin'));
init();
})();