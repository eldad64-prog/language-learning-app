(()=>{'use strict';
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
let learning='th',translation='he',toastTimer,supabaseClient=null,schemaReady=false;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5200)}
function setView(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));['register','login','admin'].forEach(v=>$('#'+v+'View').classList.toggle('hidden',v!==name))}
$$('.tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#showAdmin').addEventListener('click',()=>setView('admin'));
function setupChoices(id,callback){const root=$('#'+id);root.addEventListener('click',e=>{const b=e.target.closest('[data-lang]');if(!b)return;root.querySelectorAll('.choice').forEach(x=>x.classList.toggle('selected',x===b));callback(b.dataset.lang)})}
setupChoices('learningChoices',v=>learning=v);setupChoices('translationChoices',v=>translation=v);
function setConnection(message,good=false){const el=$('#connectionState');if(el){el.textContent=message;el.className='connection '+(good?'good':'wait')}}
async function init(){
 if(!window.supabase?.createClient||!window.LINGUA_SUPABASE_CONFIG){setConnection('ספריית החיבור לא נטענה');return}
 const {url,publishableKey}=window.LINGUA_SUPABASE_CONFIG;
 supabaseClient=window.supabase.createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 try{
  const {error}=await supabaseClient.from('profiles').select('id').limit(1);
  if(error){setConnection('החיבור קיים; ממתינים להתקנת מסד הנתונים');console.info('Lingua schema check:',error.message);return}
  schemaReady=true;setConnection('החיבור למסד הנתונים פעיל',true);
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session){const {data:profile}=await supabaseClient.from('profiles').select('approval_status').eq('id',session.user.id).maybeSingle();if(profile?.approval_status==='approved')toast('אתה מחובר לחשבון שלך.');else toast('החשבון ממתין לאישור מנהל.');}
 }catch(err){setConnection('לא ניתן לאמת את מסד הנתונים');console.error(err)}
}
$('#registerForm').addEventListener('submit',async e=>{
 e.preventDefault();const p=$('#password').value,p2=$('#password2').value;
 if(p!==p2){toast('הסיסמאות אינן תואמות.');return}
 if(learning===translation){toast('בחר שפת לימוד ושפת תרגום שונות.');return}
 if(!supabaseClient||!schemaReady){toast('ההרשמה תיפתח לאחר התקנת מסד הנתונים ובדיקת ההרשאות.');return}
 const button=$('#registerForm button[type=submit]');button.disabled=true;
 try{
  const {data,error}=await supabaseClient.auth.signUp({email:$('#email').value.trim(),password:p,options:{data:{display_name:$('#displayName').value.trim(),learning_language:learning,translation_language:translation}}});
  if(error)throw error;
  toast(data.session?'נוצר חשבון. הוא ממתין לאישור מנהל.':'נשלח אימייל לאימות. לאחר האימות החשבון ימתין לאישור מנהל.');
 }catch(err){toast('לא ניתן להשלים הרשמה: '+err.message)}finally{button.disabled=false}
});
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!supabaseClient||!schemaReady){toast('הכניסה תופעל לאחר התקנת מסד הנתונים ובדיקת ההרשאות.');return}
 const fields=$$('#loginForm input');try{
  const {data,error}=await supabaseClient.auth.signInWithPassword({email:fields[0].value.trim(),password:fields[1].value});
  if(error)throw error;
  const {data:profile,error:profileError}=await supabaseClient.from('profiles').select('approval_status').eq('id',data.user.id).maybeSingle();
  if(profileError||!profile){await supabaseClient.auth.signOut();throw new Error('לא נמצא פרופיל משתמש. יש לפנות למנהל.')}
  if(profile.approval_status!=='approved'){await supabaseClient.auth.signOut();toast('החשבון עדיין לא אושר על ידי מנהל המערכת.');return}
  toast('התחברת בהצלחה. ממשק הלימוד יופעל בשלב הבא.');
 }catch(err){toast('הכניסה נכשלה: '+err.message)}
});
init();
})();