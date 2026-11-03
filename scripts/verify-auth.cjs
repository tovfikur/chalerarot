const {chromium}=require('@playwright/test');
const {PrismaClient}=require('../backend/node_modules/@prisma/client');
const {randomBytes}=require('crypto');
(async()=>{
 if (!process.env.VERIFY_AUTH_DATABASE_URL || !process.env.VERIFY_AUTH_API_URL || !process.env.VERIFY_AUTH_WEB_URL) throw Error('Set VERIFY_AUTH_DATABASE_URL, VERIFY_AUTH_API_URL and VERIFY_AUTH_WEB_URL for an empty test environment');
 const db=new PrismaClient({datasources:{db:{url:process.env.VERIFY_AUTH_DATABASE_URL}}});
 const base=process.env.VERIFY_AUTH_API_URL;const suffix=Date.now();const admin='testadmin'+suffix,staff='teststaff'+suffix;const password=randomBytes(18).toString('hex');let browser;
 try {
  if(await db.user.count()) throw Error('First-account test requires no existing users');
  if((await fetch(base+'/bootstrap')).status!==401)throw Error('Unauthenticated API exposed');
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.VERIFY_AUTH_WEB_URL);await page.getByLabel('নাম',{exact:true}).fill('Test Admin');await page.getByLabel('ফোন নম্বর',{exact:true}).fill('01700000000');await page.getByLabel('ব্যবহারকারীর নাম',{exact:true}).fill(admin);await page.getByLabel('পাসওয়ার্ড (অন্তত ১০ অক্ষর)',{exact:true}).fill(password);await page.getByLabel('পাসওয়ার্ড নিশ্চিত করুন',{exact:true}).fill(password);await page.getByTestId('login-submit').click();
  await page.goto(process.env.VERIFY_AUTH_WEB_URL+'/#/settings');await page.getByTestId('settings-users').waitFor();await page.reload();await page.getByTestId('settings-users').click();await page.getByTestId('add-user').click();
  await page.getByLabel(/Full name|পূর্ণ নাম/).fill('Test Staff');await page.getByLabel(/Contact phone|যোগাযোগের ফোন/).fill('01800000000');await page.getByLabel(/^(Username|ব্যবহারকারীর নাম)$/).fill(staff);await page.getByLabel(/Password \(at least|পাসওয়ার্ড \(অন্তত/).fill(password);await page.getByTestId('save-user').click();await page.getByText('Test Staff · '+staff,{exact:true}).waitFor();
  const all=await (await context.request.get(base+'/users')).json();if(all.some(u=>u.passwordHash))throw Error('Hash disclosed');
  if((await context.request.post(base+'/auth/setup',{data:{name:'Intruder',phone:'01700000000',username:'intruder',password}})).status()!==409)throw Error('Setup not closed');
  const staffUser=all.find(u=>u.username===staff);const staffContext=await browser.newContext();
  if((await staffContext.request.post(base+'/auth/login',{data:{username:staff,password:'wrong'}})).status()!==401)throw Error('Wrong password accepted');
  if((await staffContext.request.post(base+'/auth/login',{data:{username:staff,password}})).status()!==200)throw Error('Staff login failed');
  if((await staffContext.request.get(base+'/users')).status()!==403)throw Error('Staff can manage users');
  if((await staffContext.request.put(base+'/settings',{data:{}})).status()!==403)throw Error('Staff can change business');
  const bad=await staffContext.request.put(base+'/auth/profile',{data:{name:'Test Staff',phone:'01800000000',password:password+'x',currentPassword:'wrong'}});if(bad.status()!==400)throw Error('Password reset without verification');
  if((await context.request.put(base+'/users/'+staffUser.id,{data:{...staffUser,password:'',active:false}})).status()!==200)throw Error('Deactivate failed');
  if((await staffContext.request.get(base+'/bootstrap')).status()!==401)throw Error('Session not revoked');
  const adminUser=all.find(u=>u.username===admin);if((await context.request.put(base+'/users/'+adminUser.id,{data:{...adminUser,password:'',active:false}})).status()!==400)throw Error('Self-lockout allowed');
  const evil=await context.request.post(base+'/auth/logout',{headers:{Origin:'https://evil.example'}});if(evil.status()!==403)throw Error('Cross-origin mutation allowed');
  await page.getByTestId('settings-back').click();await page.getByTestId('settings-profile').click();await page.getByTestId('logout').click();await page.getByTestId('login-submit').waitFor();if((await context.request.get(base+'/bootstrap')).status()!==401)throw Error('Logout failed');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS: first-admin setup, UI user creation, reload persistence, login/logout, API protection, role restrictions, password verification, deactivation session revocation, setup closure, self-lockout protection, origin checks.');
 } finally {if(browser)await browser.close();await db.user.deleteMany({where:{username:{in:[admin,staff]}}});await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1});
