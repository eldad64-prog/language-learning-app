(function(){
  "use strict";
  const STORAGE_KEY = "language-app-progress-v1";
  const cfg = window.LANGUAGE_APP_SUPABASE || {};
  const ready = cfg.url && cfg.anonKey &&
    /^https:\/\//.test(cfg.url) &&
    !String(cfg.url).includes("PASTE_") &&
    !String(cfg.anonKey).includes("PASTE_");
  const panel = document.createElement("section");
  panel.id = "cloud-sync-panel";
  panel.dir = "rtl";
  panel.style.cssText = "margin:0 0 14px;padding:14px;border:1px solid #cfe4e2;border-radius:18px;background:#fff;box-shadow:0 6px 20px #123c4610;font:14px system-ui;color:#183238";
  panel.innerHTML = '<div style="font-weight:800;font-size:16px;margin-bottom:6px">☁️ גיבוי וסנכרון בין מכשירים</div><div id="cloud-sync-status" style="color:#647a7d;margin-bottom:10px">בודק הגדרות…</div><div id="cloud-sync-form" style="display:grid;gap:8px"><input id="cloud-email" type="email" autocomplete="username" placeholder="כתובת אימייל" style="padding:11px;border:1px solid #cbdad8;border-radius:10px;font:inherit"><input id="cloud-password" type="password" autocomplete="current-password" placeholder="סיסמה (לפחות 6 תווים)" style="padding:11px;border:1px solid #cbdad8;border-radius:10px;font:inherit"><div style="display:flex;gap:8px"><button id="cloud-login" type="button" style="flex:1;padding:11px;border:0;border-radius:10px;background:#087f8c;color:white;font-weight:700">התחברות</button><button id="cloud-signup" type="button" style="flex:1;padding:11px;border:0;border-radius:10px;background:#e8f4f2;color:#183238;font-weight:700">יצירת חשבון</button></div><button id="cloud-sync-now" type="button" style="padding:10px;border:1px solid #cbdad8;border-radius:10px;background:white;color:#183238">סנכרן עכשיו</button><button id="cloud-logout" type="button" style="padding:8px;border:0;background:transparent;color:#647a7d">התנתקות</button></div><div style="font-size:11px;color:#647a7d;margin-top:8px">ההתקדמות המקומית נשארת במכשיר. הסנכרון בענן מופעל רק לאחר הגדרת Supabase והתחברות.</div>';
  const main = document.querySelector("main#app");
  if (main && main.parentNode) main.parentNode.insertBefore(panel, main);
  const status = msg => { const el=document.getElementById("cloud-sync-status"); if(el)el.textContent=msg; };
  if (!ready) { status("החיבור עדיין לא הוגדר. יש להוסיף כתובת פרויקט ומפתח anon ב-supabase-config.js."); return; }
  if (!window.supabase || !window.supabase.createClient) { status("ספריית Supabase לא נטענה. בדוק חיבור לאינטרנט ורענן."); return; }
  const client = window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let user=null, timer=null, busy=false;
  const localState=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}catch(e){return {}}};
  const merge=(a,b)=>{
    if(Array.isArray(a)&&Array.isArray(b)){
      const all=[...a,...b], seen=new Set();
      return all.filter(v=>{const k=typeof v==="object"&&v!==null?(v.id!=null?"id:"+v.id:JSON.stringify(v)):typeof v+":"+String(v);if(seen.has(k))return false;seen.add(k);return true;});
    }
    if(a&&b&&typeof a==="object"&&typeof b==="object"&&!Array.isArray(a)&&!Array.isArray(b)){
      const out={...a}; for(const k of Object.keys(b))out[k]=k in out?merge(out[k],b[k]):b[k]; return out;
    }
    return b===undefined?a:b;
  };
  const upload=async()=>{
    if(!user||busy)return;
    busy=true;status("שומר את ההתקדמות בענן…");
    try{
      const state=localState();
      const {error}=await client.from("language_app_state").upsert({user_id:user.id,state,updated_at:new Date().toISOString()},{onConflict:"user_id"});
      if(error)throw error;
      status("הסנכרון הושלם · "+new Date().toLocaleTimeString("he-IL",{hour:"2-digit",minute:"2-digit"}));
    }catch(e){status("שגיאה בשמירה בענן: "+(e.message||"בדוק הרשאות וטבלת Supabase"));}
    finally{busy=false;}
  };
  const download=async()=>{
    if(!user)return;
    status("טוען נתונים מהענן ומשלב עם הנתונים במכשיר…");
    try{
      const {data,error}=await client.from("language_app_state").select("state").eq("user_id",user.id).maybeSingle();
      if(error)throw error;
      const local=localState(), merged=data&&data.state?merge(data.state,local):local;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(merged));
      await upload();
      status("הנתונים אוחדו ונשמרו. אפשר להמשיך ללמוד.");
      if(typeof window.render==="function")window.render();
      else setTimeout(()=>location.reload(),300);
    }catch(e){status("לא ניתן לטעון נתונים: "+(e.message||"בדוק את הגדרת הטבלה"));}
  };
  const setLoggedIn=async session=>{
    user=session&&session.user||null;
    const form=document.getElementById("cloud-sync-form");
    if(form)form.style.display=user?"grid":"grid";
    if(user){status("מחובר כ־"+(user.email||"חשבון Supabase")+" · מסנכרן…");await download();}
    else status("לא מחובר. התחבר כדי לגבות ולסנכרן בין מכשירים.");
  };
  document.getElementById("cloud-login").onclick=async()=>{
    const email=document.getElementById("cloud-email").value.trim(),password=document.getElementById("cloud-password").value;
    if(!email||!password){status("יש להזין אימייל וסיסמה.");return;}
    status("מתחבר…");const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){status("התחברות נכשלה: "+error.message);return;}await setLoggedIn(data.session);
  };
  document.getElementById("cloud-signup").onclick=async()=>{
    const email=document.getElementById("cloud-email").value.trim(),password=document.getElementById("cloud-password").value;
    if(!email||password.length<6){status("הזן אימייל וסיסמה באורך 6 תווים לפחות.");return;}
    status("יוצר חשבון…");const {data,error}=await client.auth.signUp({email,password});
    if(error){status("יצירת החשבון נכשלה: "+error.message);return;}
    status(data.session?"החשבון נוצר. מסנכרן…":"נשלח אימייל לאימות. אשר אותו ואז התחבר.");
    if(data.session)await setLoggedIn(data.session);
  };
  document.getElementById("cloud-sync-now").onclick=()=>user?upload():status("תחילה יש להתחבר.");
  document.getElementById("cloud-logout").onclick=async()=>{await client.auth.signOut();user=null;status("התנתקת. הנתונים המקומיים נשארו במכשיר.");};
  const originalSet=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){const result=originalSet.apply(this,arguments);if(k===STORAGE_KEY&&user){clearTimeout(timer);timer=setTimeout(upload,1200);}return result;};
  client.auth.getSession().then(({data})=>setLoggedIn(data.session)).catch(e=>status("שגיאת התחברות: "+e.message));
  client.auth.onAuthStateChange((_event,session)=>{if((session&&session.user&&session.user.id)!==(user&&user.id))setLoggedIn(session);});
})();