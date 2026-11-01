(()=>{'use strict';
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];let learning='th',translation='he';let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4200)}
function setView(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));['register','login','admin'].forEach(v=>$('#'+v+'View').classList.toggle('hidden',v!==name))}
$$('.tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#showAdmin').addEventListener('click',()=>setView('admin'));
function setupChoices(id,callback){const root=$('#'+id);root.addEventListener('click',e=>{const b=e.target.closest('[data-lang]');if(!b)return;root.querySelectorAll('.choice').forEach(x=>x.classList.toggle('selected',x===b));callback(b.dataset.lang)})}
setupChoices('learningChoices',v=>learning=v);setupChoices('translationChoices',v=>translation=v);
$('#registerForm').addEventListener('submit',e=>{e.preventDefault();const p=$('#password').value,p2=$('#password2').value;if(p!==p2){toast('הסיסמאות אינן תואמות. בדוק ונסה שוב.');return}if(learning===translation){toast('בחר שפת לימוד ושפת תרגום שונות זו מזו.');return}toast('ממשק התצוגה מוכן. הרשמה אמיתית תופעל לאחר חיבור Supabase ואימות מאובטח.');});
$('#loginForm').addEventListener('submit',e=>{e.preventDefault();toast('הכניסה תופעל לאחר חיבור מערכת האימות.');});
})();