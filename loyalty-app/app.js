/* ============================================================
   Aramco Rewards — clickable prototype
   Vanilla JS, no dependencies, no network calls.
   ============================================================ */
(function () {
'use strict';

/* ---------------------------------------------------------- data */

var SCREENS = [
  { g:'01 · Onboarding and identity', epic:'E1 · OTP, PDPL consent, biometrics' },
  { n:1,  t:'Welcome',              s:'welcome',   note:'Leads with the earn weighting, not the brand. Hero image is a slot for real forecourt photography.' },
  { n:2,  t:'Mobile number',        s:'mobile',    note:'Country code fixed to +966. Keypad on screen so the field never sits behind a system keyboard.' },
  { n:3,  t:'OTP',                  s:'otp',       note:'Six boxes, auto-advance on the sixth digit. No submit tap needed.' },
  { n:4,  t:'PDPL consent',         s:'consent',   note:'Three uses in plain language. Only the marketing one is optional, and it is off by default.' },
  { n:5,  t:'Biometric enrolment',  s:'biometric', note:'Offered once, skippable. Sign-in has to be under a second at the pump.' },
  { n:6,  t:'Locked state',         s:'locked',    note:'Balance and rewards hidden until the face check passes. The wallet pass still scans while locked.' },

  { g:'02 · Home, relevance and the forecourt', epic:'E5 / E6 / E7 · offers, messaging, station' },
  { n:7,  t:'Home',                 s:'home',      note:'Balance, tier progress in visits, four quick actions, then the ranked feed. Nearest station above the fold.' },
  { n:8,  t:'Next-best-offer push', s:'push',      note:'Location and time triggered, on the preferred channel, frequency capped. States the channel and cap in the banner.' },
  { n:9,  t:'Offer detail',         s:'offer',     note:'Every offer explains why it was selected and who released it. Transparency is a PDPL asset.', act:'offer0' },
  { n:10, t:'Station locator',      s:'stations',  note:'Map plus list with filters. Live pump availability and services per site; map is a slot for the real tiles.' },
  { n:11, t:'Station detail',       s:'station',   note:'Pump picker with busy pumps blocked, then pay, café and wash in one screen.', act:'station0' },
  { n:12, t:'Authorise the pump',   s:'authorise', note:'Grade, card and the pre-auth hold explained before the tap. One primary action.', act:'pump3' },

  { g:'03 · Paying, earning and attaching', epic:'E3 / E7 · earn, payment, order ahead' },
  { n:13, t:'Fuelling',             s:'fuelling',  note:'Live amount and litres, readable from arm’s length in daylight. Points shown as they accrue.' },
  { n:14, t:'Receipt',              s:'receipt',   note:'States the posting time, counts the visit, and pushes the 3× nudge inside. Redemption is the metric.' },
  { n:15, t:'Café order ahead',     s:'cafe',      note:'Quantity steppers, points per item visible, sticky pay bar with the earn stated.' },
  { n:16, t:'Pickup',               s:'pickup',    note:'Big pickup code, counter named, order lines and points earned. Works with the member QR too.', act:'cafe2' },
  { n:17, t:'Member QR sheet',      s:'home',      note:'One scan earns and burns at the till. Reachable in one tap from every screen.', act:'qr' },
  { n:18, t:'Digital card & wallet pass', s:'card', note:'Apple and Google pass, balance updating after each stop. Scans without opening the app.' },

  { g:'04 · Rewards, account and Arabic', epic:'E2 / E4 / E8 · redeem, tiers, support' },
  { n:19, t:'Reward catalogue',     s:'rewards',   note:'Reachable-now first, locked items show progress. Low denomination, monthly reach.' },
  { n:20, t:'Reward detail',        s:'reward',    note:'Cost, balance and the balance after burning, stated before the commitment.', act:'reward0' },
  { n:21, t:'Redemption code',      s:'redemption',note:'QR and short code with an expiry. The burn happens on this visit, not a future one.', act:'reward0' },
  { n:22, t:'Account',              s:'account',   note:'Tier progress, card, notifications, language, profile, FAQ, history and account deletion.' },
  { n:23, t:'Message preferences',  s:'prefs',     note:'One preferred channel of push, email or SMS, a frequency cap and quiet hours. Consent-linked.' },
  { n:24, t:'Arabic, full RTL',     s:'home',      note:'The same home screen mirrored. Numerals and Latin runs stay left-to-right inside the RTL layout.', act:'ar' }
];

var OFFERS = [
  { id:'cafe3x', rank:'#1 for you', title:'Triple points on café', short:'3× on every hot drink',
    body:'Every hot drink earns three times the points, at the counter and on order ahead. No minimum, no voucher to remember.',
    why:'You bought coffee on 4 of your last 5 weekday stops, and you are 400 m from a cafe site right now.',
    who:'Aramco Retail — national café campaign. Valid at all café sites in Riyadh.',
    earn:'3 pts per SAR', valid:'Today, until 11:00', where:'Counter or order ahead',
    art:'linear-gradient(150deg,#6b4226,#c98b3a)', expiry:'Until 11:00' },
  { id:'wash900', rank:'#2 for you', title:'900 points on a wash', short:'Keep it shining inside and out',
    body:'A premium wash earns 900 points instead of the usual 250. Enough on its own to put a free coffee in reach.',
    why:'Your last wash was 41 days ago, and you passed a wash site twice this week.',
    who:'Aramco Retail — Riyadh region wash push. Selected sites.',
    earn:'900 pts flat', valid:'This week', where:'Wash bay, selected sites',
    art:'linear-gradient(150deg,#12324a,#0086c8)', expiry:'Ends Sunday' },
  { id:'f1', rank:'#3 for you', title:'Race weekend bonus', short:'Double points, Thursday to Sunday',
    body:'Everything earns double across race weekend. Fuel, café, wash and store, at every site in the Kingdom.',
    why:'You are a race weekend regular — you filled up on both of the last two.',
    who:'Aramco brand — national sponsorship activation.',
    earn:'2× everything', valid:'Thu–Sun', where:'Every site',
    art:'linear-gradient(150deg,#0b3b34,#00a651)', expiry:'Ends Sunday' },
  { id:'store', rank:'#4 for you', title:'150 bonus on the store', short:'Any basket over 40 SAR',
    body:'Spend 40 SAR or more in the store and take 150 bonus points on top of the usual earn.',
    why:'You buy water and snacks on about a third of your stops.',
    who:'Aramco Retail — convenience category.',
    earn:'+150 bonus pts', valid:'Until 31 Aug', where:'Store, all sites',
    art:'linear-gradient(150deg,#2c4a3b,#84bd00)', expiry:'Until 31 Aug' }
];

var STATIONS = [
  { name:'Al Kharji road',   dist:'2.4 km', free:6, total:8,  min:9,  img:'art-station-1', tags:['cafe','wash','offer','open'],
    pumps:[{n:1,busy:false},{n:2,busy:true},{n:3,busy:false},{n:4,busy:false},{n:5,busy:true},{n:6,busy:false},{n:7,busy:false},{n:8,busy:false}] },
  { name:'Riyadh station',   dist:'1.7 km', free:4, total:6,  min:10, img:'art-station-2', tags:['cafe','open'],
    pumps:[{n:1,busy:false},{n:2,busy:false},{n:3,busy:true},{n:4,busy:false},{n:5,busy:false},{n:6,busy:true}] },
  { name:'King Fahd branch', dist:'5.1 km', free:2, total:10, min:14, img:'art-station-3', tags:['wash','offer','open'],
    pumps:[{n:1,busy:true},{n:2,busy:true},{n:3,busy:true},{n:4,busy:false},{n:5,busy:true},{n:6,busy:true},{n:7,busy:true},{n:8,busy:false},{n:9,busy:true},{n:10,busy:true}] }
];

var CAFE = [
  { id:'flat',   name:'Flat white',      price:15, pts:45, art:'linear-gradient(140deg,#6b4226,#c98b3a)' },
  { id:'arabic', name:'Arabic coffee',   price:12, pts:36, art:'linear-gradient(140deg,#8a6b2f,#d9b98a)' },
  { id:'latte',  name:'Iced latte',      price:18, pts:54, art:'linear-gradient(140deg,#7a5c3a,#e0cbb0)' },
  { id:'date',   name:'Date cake slice', price:14, pts:14, icon:'i-gift', art:'linear-gradient(140deg,#5c3a1e,#a3763f)' },
  { id:'water',  name:'Water 600 ml',    price:3,  pts:3,  icon:'i-bottle', art:'linear-gradient(140deg,#0086c8,#7fd4f0)' }
];

var REWARDS = [
  { id:'coffee', name:'Any hot drink',       cost:450,  cat:'cafe', body:'Any size, any café site. Made to order at the counter.',            art:'linear-gradient(140deg,#6b4226,#c98b3a)' },
  { id:'cake',   name:'Date cake slice',     cost:400,  cat:'cafe', icon:'i-gift', body:'The one people come back for. Available at all café counters.', art:'linear-gradient(140deg,#5c3a1e,#a3763f)' },
  { id:'water',  name:'Water, 6-pack',       cost:600,  cat:'cafe', icon:'i-bottle', body:'Six 600 ml bottles from the store chiller.',       art:'linear-gradient(140deg,#0086c8,#7fd4f0)' },
  { id:'fuel10', name:'10 SAR off fuel',     cost:1200, cat:'fuel', body:'Comes off the pump total at the till on this visit.',               art:'linear-gradient(140deg,#0b3b34,#00a651)' },
  { id:'wash',   name:'Basic car wash',      cost:3500, cat:'wash', body:'One automatic wash at any site with a wash bay.',                   art:'linear-gradient(140deg,#12324a,#0086c8)' },
  { id:'fuel25', name:'25 SAR off fuel',     cost:5000, cat:'fuel', body:'The workhorse redemption. Comes off the pump total.',               art:'linear-gradient(140deg,#0d6b57,#84bd00)' },
  { id:'washp',  name:'Premium wash',        cost:7500, cat:'wash', body:'Wash, wax and interior vacuum. Selected sites.',                    art:'linear-gradient(140deg,#1c2b3a,#4a7fa8)' },
  { id:'fuel50', name:'50 SAR off fuel',     cost:9500, cat:'fuel', body:'Silver tier and above reach this in about two months.',             art:'linear-gradient(140deg,#0b3b34,#0086c8)' }
];

var HISTORY = [
  { t:'Fuel — Al Kharji Road', d:'27 Aug, 09:44', p:'+185', a:'184.60 SAR' },
  { t:'Cafe — Al Kharji Road', d:'24 Aug, 08:12', p:'+90',  a:'30.00 SAR' },
  { t:'Redeemed — Any hot drink', d:'22 Aug, 08:05', p:'−450', a:'—' },
  { t:'Fuel — Riyadh Station', d:'19 Aug, 18:30', p:'+142', a:'142.10 SAR' },
  { t:'Store — Riyadh Station', d:'19 Aug, 18:34', p:'+22',  a:'22.00 SAR' }
];

/* ---------------------------------------------------------- Arabic copy */

var AR = {
'pts':'نقطة','m.cta':'إرسال الرمز','re.complete':'اكتملت','re.paidwith':'الدفع عبر',
're.ptsfill':'نقاط هذه التعبئة','re.vehicle':'المركبة','re.see':'عرض الإيصال','sl.of':'من',
'st.mins':'دقائق<br>للوصول','st.takeme':'خذني إلى هناك','st.2':'فرع الملك فهد','rw.card':'البطاقة الرقمية',
'q.qr':'رمز العضوية','ac.vehicle':'مركبتي','ac.vehiclesub':'تظهر في شاشة المضخة',
'cta.continue':'متابعة','cta.seeall':'عرض الكل','cta.close':'إغلاق','cta.gotit':'تمام','cta.cancel':'الاحتفاظ بحسابي',
'tab.home':'الرئيسية','tab.rewards':'المكافآت','tab.stations':'المحطات','tab.account':'حسابي','tab.menu':'القائمة',

'w.slot':'مساحة صورة — محطة حقيقية',
'w.h':'كل زيارة<br>يجب أن<br><span class="accent">تكافئك</span>',
'w.p':'اجمع على الوقود، واجمع أسرع على القهوة وغسيل السيارة والخدمة. مكافآت تصل إليها في شهر قيادة عادي.',
'w.cta':'انضم إلى أرامكو ريواردز','w.signin':'لدي حساب بالفعل',

'm.h':'ما رقم<br>جوالك ؟','m.p':'اجمع على الوقود، واجمع أسرع على القهوة وغسيل السيارة والخدمة. مكافآت تصل إليها في شهر قيادة عادي.',
'm.cc':'+966‎','m.note':'أرقام سعودية فقط في المرحلة الأولى. رمز الدولة ثابت.','m.demo':'تجربة',

'o.h':'أدخل<br>رمزك','o.p':'أُرسل إلى','o.auto':'لا حاجة للضغط — الرقم السادس يسجّل دخولك.','o.resend':'إعادة الإرسال خلال 0:24',

'c.h':'كيف نستخدم<br>بياناتك','c.p':'ثلاثة استخدامات بلغة واضحة. اثنان لازمان لتشغيل البرنامج. الثالث اختيارك، ومغلق حتى تفعّله.',
'c.1t':'إدارة عضويتك','c.1p':'النقاط والفئة والإيصالات والبطاقة الرقمية. مطلوب.',
'c.2t':'ترتيب العروض لك','c.2p':'زياراتك ومشترياتك ترتّب القائمة. مطلوب للقائمة المرتّبة.',
'c.3t':'إرسال العروض إليك','c.3p':'إشعار أو بريد أو رسالة على قناة واحدة تختارها. اختياري — مغلق افتراضياً.',
'c.pdpl':'بموجب نظام حماية البيانات الشخصية يمكنك سحب الموافقة الاختيارية في أي وقت من «حسابي»، وحذف الحساب بالكامل من المكان نفسه.',
'c.cta':'أوافق وأتابع','c.read':'قراءة الإشعار كاملاً',

'b.h':'الدخول<br>ببصمة الوجه','b.p':'عند المضخة تريد البطاقة على الشاشة خلال أقل من ثانية. بصمة الوجه تفعل ذلك. نسألك مرة واحدة، ويمكنك تفعيلها لاحقاً من «حسابي».',
'b.k1':'فتح التطبيق','b.v1':'فحص الوجه','b.k2':'عرض رمز العضوية','b.v2':'فحص الوجه','b.k3':'بطاقة المحفظة عند الكاشير','b.v3':'بدون فحص',
'b.cta':'تفعيل بصمة الوجه','b.skip':'ليس الآن',

'l.h':'مقفل','l.p':'الرصيد والمكافآت مخفية حتى ينجح فحص الوجه.','l.cta':'افتح ببصمة الوجه',
'l.wallet':'بطاقة المحفظة تُمسح عند الكاشير والهاتف مقفل — بدون فحص وجه وبدون فتح التطبيق.',

'h.greet':'صباح<br>الخير','h.name':'فيصل الحربي','h.balance':'رصيد النقاط',
'h.prog':'<b class="nums" data-visits>4</b> من <b class="nums" data-visits-target>6</b> زيارة مؤهلة نحو <span data-next-tier>الفضي</span>',
'h.progsub':'— تُحتسب بالزيارات لا بالإنفاق',
'q.pump':'الدفع عند المضخة','q.cafe':'اطلب من المقهى','q.rewards':'المكافآت','q.stations':'المحطات',
'h.nearest':'وقت الاستراحة؟','h.picked':'مختارة لك','h.why':'لماذا هذه؟',
'st.0':'طريق الخرج','st.1':'محطة الرياض','st.open':'مفتوحة','st.free':'مضخات متاحة','st.cafeopen':'المقهى مفتوح','st.24':'24 ساعة',
'h.f1tag':'أسبوع السباق','h.f1h':'اربح أكثر مع أرامكو ريواردز','h.f1p':'ضعف النقاط على كل زيارة للمقهى طوال أسبوع السباق، من الخميس إلى الأحد.','h.f1cta':'استعرض العروض',
'h.foot':'معدلات الجمع وحدود الفئات قيم مبدئية لاقتصاديات المرحلة الأولى.',

'p.day':'الخميس 27 أغسطس','p.now':'الآن','p.h':'تبعد 400 متر عن طريق الخرج',
'p.p':'القهوة بثلاثة أضعاف النقاط حتى الساعة 11:00 هذا الصباح. اضغط لتراه قبل أن تدخل.',
'p.ch':'إشعار — قناتك المختارة','p.cap':'2 من 3 هذا الأسبوع',
'p.note':'يُطلق بالموقع والوقت، بحد ثلاث رسائل أسبوعياً، وصامت خلال ساعات الهدوء. القناة والحد من «حسابي».','p.manage':'تغيير القناة أو الحد',

'of.why':'لماذا ترى هذا','of.who':'من أطلقه','of.earn':'الجمع','of.valid':'ساري','of.where':'أين','of.cta':'اطلب مسبقاً الآن','of.find':'ابحث عن فرع مقهى',

'sl.h':'المحطات','sl.slot':'خرائط — مساحة المزوّد',
'sl.f1':'القريبة','sl.f2':'عرض ساري','sl.f3':'مقهى','sl.f4':'غسيل سيارات','sl.f5':'مفتوحة 24 ساعة',
'sd.pick':'اختر المضخة','sd.busy':'المضخات المشغولة محجوبة — لا يمكنك تفويض مضخة يستخدمها غيرك.',
'sd.also':'متوفر هنا','sd.cafe':'المقهى','sd.cafep':'طلب مسبق · 3× نقاط','sd.wash':'غسيل السيارة','sd.washp':'من 25 ريال · جمع عادي','sd.cta':'المتابعة إلى المضخة',

'au.h':'تفويض المضخة <span class="nums" data-pump>3</span>','au.p':'اختر الدرجة، أكّد البطاقة، ثم فوّض. لا يُخصم شيء حتى تنتهي من التعبئة.',
'au.grade':'الدرجة','au.diesel':'ديزل','au.card':'البطاقة','au.default':'البطاقة الافتراضية','au.change':'تغيير',
'au.hold':'نحجز <b class="nums">300 ريال</b> على البطاقة أثناء تشغيل المضخة. عند الانتهاء يُحرّر الحجز ويُخصم الوقود الذي أخذته فقط — عادةً خلال ساعة.',
'au.earn':'هذه الزيارة تُحتسب رقم <b class="nums" data-visits-next>5</b> من <b class="nums" data-visits-target>6</b> نحو <span data-next-tier>الفضي</span>.','au.cta':'فوّض وابدأ',

'fu.pump':'المضخة','fu.running':'جارٍ التعبئة','fu.litres':'لتر','fu.earning':'نقطة تُجمع',
'fu.p':'واضحة من مسافة ذراع عند المضخة. تبقى الشاشة مضاءة حتى تعيد الفوهة.','fu.stop':'أوقف وأظهر الإيصال','fu.auto':'أو أعد الفوهة فقط — يظهر الإيصال تلقائياً.',

're.h':'الإيصال','re.paid':'دُفعت ببطاقة فيزا •••• 4417','re.where':'طريق الخرج · المضخة <b class="nums" data-pump>3</b>','re.time':'27 أغسطس، 09:44',
're.pts':'النقاط المكتسبة','re.visit':'زيارة مؤهلة','re.of6':'من <span class="nums" data-visits-target>6</span> نحو <span data-next-tier>الفضي</span>','re.posting':'ترحيل الرصيد','re.posted':'خلال 38 ثانية',
're.postnote':'النقاط تصل خلال أقل من دقيقة، فالرصيد الذي تراه عند الكاشير هو الرصيد الذي يمكنك صرفه.',
're.nudge':'ما دمت هنا','re.nudgeh':'القهوة بثلاثة أضعاف حتى 11:00',
're.nudgep':'لديك <b class="nums" data-points>5,500</b> نقطة. الفلات وايت يستغرق دقيقتين ويقرّبك 45 نقطة من واحد مجاني.','re.nudgecta':'اطلب مسبقاً',
're.email':'أرسله بالبريد','re.spend':'اصرف النقاط',

'ca.h':'المقهى — طلب مسبق','ca.sub':'طريق الخرج · جاهز خلال 4 دقائق تقريباً',
'ca.promo':'أسبوع السباق: كل مشروب ساخن يجمع 3× نقاط حتى الساعة 11:00.',
'ca.items':'صنف','ca.earns':'يجمع','ca.pay':'ادفع',

'pk.h':'تم الطلب','pk.code':'أظهر هذا عند','pk.counter':'طاولة المقهى 2','pk.ready':'جاهز خلال 4 دقائق تقريباً · سننبّهك',
'pk.lines':'صنف','pk.earned':'النقاط المكتسبة','pk.newbal':'الرصيد الجديد',
'pk.qr':'لا تريد قراءة رمز بصوت عالٍ؟ رمز عضويتك يعمل عند الطاولة أيضاً — يمسحه الباريستا فيظهر الطلب.',
'pk.showqr':'أظهر رمز العضوية','pk.done':'العودة للرئيسية',

'qr.h':'رمز العضوية','qr.p':'مسحة واحدة تجمع وتصرف عند الكاشير.','qr.cta':'عرض البطاقة الرقمية وبطاقة المحفظة',

'dc.h':'البطاقة الرقمية وبطاقة المحفظة','dc.brand':'ريواردز',
'dc.p':'امسحها عند الكاشير والهاتف مقفل. أضفها إلى محفظتك فتعمل دون فتح التطبيق.',
'dc.apple':'أضف إلى Apple Wallet','dc.google':'أضف إلى Google Wallet',
'dc.in':'في Apple Wallet','dc.inp':'البطاقة تحدّث الرصيد تلقائياً بعد كل زيارة — بلا تطبيق وبلا تحديث يدوي.',
'dc.f1':'فوري','dc.f1p':'امسح لتجمع','dc.f2':'تلقائي','dc.f2p':'تحديث الرصيد','dc.f3':'دون إنترنت','dc.f3p':'يعمل عند الكاشير','dc.f4':'آمن','dc.f4p':'وخاص',

'rw.h':'المكافآت','rw.spend':'نقاط للصرف','rw.reach':'ست مكافآت في متناولك اليوم.',
'rw.f1':'الكل','rw.f2':'متاحة الآن','rw.f3':'مقهى','rw.f4':'وقود','rw.f5':'غسيل',
'rw.foot':'الفئات الصغيرة أولاً، ليصل العضو المعتاد إلى شيء كل شهر. الأسعار قيم مبدئية للمرحلة الأولى.',

'rd.cost':'تكلفة المكافأة','rd.bal':'رصيدك','rd.after':'<b>الرصيد بعد الصرف</b>','rd.enough':'رصيدك يكفي — تُصرف في زيارتك القادمة.',
'rd.note':'الصرف ينتج رمزاً صالحاً لثلاثين دقيقة. الخصم يحدث في هذه الزيارة عند الكاشير — لا شيء يُحجز للمستقبل.',
'rd.cta':'اصرفها الآن','rd.back':'أكمل التصفح',

'rc.h':'أظهر هذا عند الكاشير','rc.exp':'ينتهي خلال','rc.left':'الرصيد بعدها',
'rc.note':'يمسح الكاشير الرمز فتُخصم النقاط فوراً. إذا انتهت صلاحيته لا يُخصم شيء ويمكنك الصرف مجدداً.','rc.bright':'زد إضاءة الشاشة للماسح',

'ac.tier':'تقدّم الفئة','ac.tiersub':'أي زيارة مدفوعة تُحتسب، مهما كان مبلغها.',
'ac.card':'البطاقة الرقمية وبطاقة المحفظة','ac.msg':'تفضيلات الرسائل','ac.msgsub':'إشعار · 3 أسبوعياً · هدوء 22:00–07:00',
'ac.lang':'اللغة','ac.profile':'بيانات الملف الشخصي','ac.history':'السجل والإيصالات','ac.faq':'الأسئلة والدعم',
'ac.privacy':'الخصوصية والموافقات','ac.privacysub':'نظام حماية البيانات — ما نحتفظ به ولماذا',
'ac.delete':'حذف حسابي','ac.deletesub':'يزيل الملف الشخصي وكل السجل','ac.ver':'أرامكو ريواردز · نموذج أولي 0.9 · المرحلة الأولى',

'pr.h':'تفضيلات الرسائل','pr.p':'قناة واحدة، وحد واحد، وساعات نصمت فيها. كل ذلك مرتبط بالموافقة التي منحتها عند التسجيل.',
'pr.ch':'القناة المفضلة','pr.push':'إشعار','pr.pushsub':'الأسرع، والوحيدة التي يمكن إطلاقها بالموقع','pr.email':'بريد إلكتروني','pr.sms':'رسالة نصية',
'pr.cap':'حد التكرار','pr.capl':'رسائل تسويقية أسبوعياً','pr.capsub':'رسائل الخدمة — الإيصالات والصرف — بلا حد',
'pr.quiet':'ساعات الهدوء','pr.quieton':'الصمت ليلاً','pr.nbo':'عروض قرب المحطات','pr.nbosub':'تُطلق بالموقع، ضمن الحد أعلاه',
'pr.mkt':'الموافقة التسويقية','pr.mktsub':'اسحبها هنا فتتوقف القنوات الثلاث',
'pr.note':'إيقاف الموافقة التسويقية يوقف كل رسالة ترويجية على كل قناة خلال ساعة. الإيصالات ورموز الصرف تستمر.',

'fl.h':'تصفية المحطات','fl.p':'أعداد المضخات المتاحة تتحدث كل 30 ثانية.',
'fl.1':'مفتوحة الآن','fl.2':'مضخات متاحة','fl.3':'يوجد مقهى','fl.4':'غسيل سيارات','fl.5':'عرض ساري اليوم','fl.cta':'عرض النتائج',
'rk.h':'كيف تُرتّب قائمتك','rk.p':'كل بطاقة تخبرك لماذا ظهرت. الشفافية أصل من أصول حماية البيانات، لا ميزة إضافية.',
'rk.1':'ماذا تشتري','rk.1p':'مزيج الفئات عبر آخر عشرين زيارة. المقهى هو الغالب لديك.',
'rk.2':'متى وأين تتوقف','rk.2p':'صباحات أيام العمل، غالباً على محور الخرج.',
'rk.3':'ما هو ساري الآن','rk.3p':'الحملات العاملة في مواقع تستطيع الوصول إليها اليوم.','rk.cta':'إدارة ما نستخدمه',
'pv.h':'الخصوصية والموافقات','pv.p':'نظام حماية البيانات الشخصية، المملكة العربية السعودية.',
'pv.1':'ما نحتفظ به','pv.1p':'رقم الجوال والاسم والمعاملات في مواقع أرامكو وسجل النقاط والموقع أثناء فتح التطبيق.',
'pv.2':'إلى متى','pv.2p':'السجل والإيصالات سبع سنوات كما يتطلب النظام الضريبي. ما عدا ذلك يُحذف مع الحساب.',
'pv.3':'حقوقك','pv.3p':'الاطلاع والتصحيح وسحب الموافقة والحذف — كلها من «حسابي» دون مركز اتصال.',
'hi.h':'السجل والإيصالات','fq.h':'الأسئلة والدعم',
'fq.1':'متى تظهر النقاط؟','fq.1p':'خلال أقل من دقيقة بعد الدفع. إن لم تظهر، اضغط «نقاط مفقودة» في الإيصال.',
'fq.2':'ما الزيارة المؤهلة؟','fq.2p':'أي زيارة مدفوعة مهما كان مبلغها. الفئات تتحرك بالزيارات لا بالإنفاق.',
'fq.3':'هل أصرف عند الكاشير؟','fq.3p':'نعم. داخل التطبيق أو عند الكاشير — رمز العضوية نفسه يفعل الاثنين.',
'fq.4':'لماذا حُجز مبلغ؟','fq.4p':'حجز مسبق 300 ريال أثناء تشغيل المضخة. يُحرّر عند الانتهاء.','fq.cta':'راسل الدعم',
'dl.h':'حذف حسابي','dl.p':'يُزال ملفك الشخصي وتفضيلاتك ونقاطك خلال 30 يوماً. تُحفظ الإيصالات سبع سنوات لأن النظام الضريبي يتطلب ذلك، مع فصل اسمك عنها.',
'dl.warn':'لديك <b class="nums" data-points>5,500</b> نقطة. ستُلغى ولا يمكن استعادتها.','dl.cta':'احذف نهائياً',
'mn.h':'القائمة','mn.push':'معاينة إشعار العرض التالي','mn.lock':'إقفال التطبيق'
};

var TOASTS = {
  'toast.soon':   { en:'Not built in Wave 1 — the MVP stops here.', ar:'غير مبني في المرحلة الأولى — النموذج يتوقف هنا.' },
  'toast.wallet': { en:'Pass added. It updates the balance after every stop.', ar:'أُضيفت البطاقة. تحدّث الرصيد بعد كل زيارة.' },
  'toast.email':  { en:'Receipt sent to f.alharbi@example.com', ar:'أُرسل الإيصال إلى f.alharbi@example.com' },
  'toast.delete': { en:'In the real build this needs an OTP re-check first.', ar:'في النسخة الحقيقية يتطلب هذا إعادة تحقق برمز أولاً.' },
  'toast.brightness': { en:'Screen brightened for the scanner.', ar:'أُضيئت الشاشة للماسح.' },
  'toast.locked': { en:'Required to run the programme — cannot be turned off.', ar:'مطلوب لتشغيل البرنامج — لا يمكن إيقافه.' }
};

/* ---------------------------------------------------------- helpers */

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function fmt(n) { return Number(n).toLocaleString('en-US'); }
function money(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function t(key, fallback) { return (state.lang === 'ar' && AR[key]) ? AR[key] : fallback; }

/* ---------------------------------------------------------- state */

var DARK_TOP = ['welcome', 'locked', 'push', 'fuelling', 'home', 'rewards', 'account', 'offer', 'station'];
var NO_CHROME = ['welcome', 'mobile', 'otp', 'consent', 'biometric', 'locked', 'push', 'fuelling'];

var TIERS = [
  { en: 'Bronze', ar: 'برونزي', target: 6 },
  { en: 'Silver', ar: 'فضي',    target: 8 },
  { en: 'Gold',   ar: 'ذهبي',   target: 0 }
];
var GRADE_NAME = {
  '91':     { en: 'Aramco 91', ar: 'أرامكو 91' },
  '95':     { en: 'Aramco 95', ar: 'أرامكو 95' },
  'diesel': { en: 'Diesel',    ar: 'ديزل' }
};

var state = {
  lang: 'en',
  screen: 'welcome',
  stack: [],
  points: 5500,
  tier: 0,
  visits: 4,
  phone: '',
  otp: '',
  biometrics: false,
  consent: { service: true, personalization: true, marketing: false },
  channel: 'push',
  cap: 3,
  station: 0,
  pump: 4,
  grade: '95',
  fuel: { amount: 0, litres: 0, points: 0, timer: null },
  cafe: {},
  offer: OFFERS[0],
  reward: REWARDS[0],
  redemption: null,
  notes: true
};

var PRICES = { '91': 2.18, '95': 2.33, 'diesel': 1.15 };
var GRADE_LABEL = { '91': '91', '95': '95', 'diesel': 'D' };

/* ---------------------------------------------------------- i18n */

var originals = new Map();

function applyLang() {
  document.body.setAttribute('dir', state.lang === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach(function (node) {
    var key = node.getAttribute('data-i18n');
    if (!originals.has(node)) originals.set(node, node.innerHTML);
    node.innerHTML = (state.lang === 'ar' && AR[key]) ? AR[key] : originals.get(node);
  });
  var lv = $('#langValue');
  if (lv) lv.textContent = state.lang === 'en' ? 'English · switch to العربية' : 'العربية · التبديل إلى English';
  $('#btnLang').textContent = state.lang === 'en' ? 'العربية' : 'English';
  renderState();
}

function setLang(l) {
  state.lang = l;
  applyLang();
  renderFeed(); renderStationList(); renderStation(); renderCafe(); renderRewards(); renderReward();
}

/* ---------------------------------------------------------- shared state render */

function nextTierName() {
  var next = TIERS[state.tier + 1];
  return next ? next[state.lang] : TIERS[state.tier][state.lang];
}

/* A qualifying visit is any paid stop. Reaching the target promotes the tier. */
function commitVisit() {
  var target = TIERS[state.tier].target;
  if (!target) return;
  state.visits += 1;
  if (state.visits >= target && TIERS[state.tier + 1]) {
    state.tier += 1;
    state.visits = 0;
    toast(state.lang === 'ar'
      ? ('تهانينا — وصلت إلى ' + TIERS[state.tier].ar + '.')
      : ('Tier up — you are ' + TIERS[state.tier].en + ' from this stop.'));
  }
}

function renderState() {
  var target = TIERS[state.tier].target;
  $$('[data-points]').forEach(function (n) { n.textContent = fmt(state.points); });
  $$('[data-visits]').forEach(function (n) { n.textContent = fmt(state.visits); });
  $$('[data-visits-target]').forEach(function (n) { n.textContent = fmt(target || state.visits); });
  $$('[data-visits-next]').forEach(function (n) { n.textContent = fmt(target ? Math.min(state.visits + 1, target) : state.visits); });
  $$('[data-progress]').forEach(function (n) { n.style.width = (target ? Math.round(state.visits / target * 100) : 100) + '%'; });
  $$('[data-visits-left]').forEach(function (n) { n.textContent = fmt(target ? Math.max(0, target - state.visits) : 0); });
  $$('[data-tier]').forEach(function (n) { n.textContent = TIERS[state.tier][state.lang]; });
  $$('[data-next-tier]').forEach(function (n) { n.textContent = nextTierName(); });
  $$('[data-pump]').forEach(function (n) { n.textContent = state.pump == null ? '—' : state.pump; });
  $$('[data-grade-label]').forEach(function (n) { n.textContent = GRADE_LABEL[state.grade]; });
  $$('[data-grade-name]').forEach(function (n) { n.textContent = GRADE_NAME[state.grade][state.lang]; });
}

/* ---------------------------------------------------------- faux QR renderer */

function drawQR(canvas, seed) {
  var n = canvas.width, ctx = canvas.getContext('2d');
  var h = 2166136261;
  for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  function rnd() { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; }

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = '#0b1f1c';
  var m = 2, lo = m, hi = n - m - 1;
  for (var y = lo; y <= hi; y++) {
    for (var x = lo; x <= hi; x++) {
      if (inFinder(x, y) || inAlign(x, y)) continue;
      if (rnd() < 0.47) ctx.fillRect(x, y, 1, 1);
    }
  }
  function inFinder(x, y) {
    return (x < lo + 8 && y < lo + 8) || (x > hi - 8 && y < lo + 8) || (x < lo + 8 && y > hi - 8);
  }
  function inAlign(x, y) { return x >= hi - 6 && x <= hi - 2 && y >= hi - 6 && y <= hi - 2; }

  function finder(ox, oy) {
    ctx.fillStyle = '#0b1f1c'; ctx.fillRect(ox, oy, 7, 7);
    ctx.fillStyle = '#fff'; ctx.fillRect(ox + 1, oy + 1, 5, 5);
    ctx.fillStyle = '#0b1f1c'; ctx.fillRect(ox + 2, oy + 2, 3, 3);
  }
  finder(lo, lo); finder(hi - 6, lo); finder(lo, hi - 6);
  ctx.fillStyle = '#0b1f1c'; ctx.fillRect(hi - 6, hi - 6, 5, 5);
  ctx.fillStyle = '#fff'; ctx.fillRect(hi - 5, hi - 5, 3, 3);
  ctx.fillStyle = '#0b1f1c'; ctx.fillRect(hi - 4, hi - 4, 1, 1);
  for (var k = lo + 8; k <= hi - 8; k++) {
    if (k % 2 === 0) { ctx.fillStyle = '#0b1f1c'; ctx.fillRect(k, lo + 6, 1, 1); ctx.fillRect(lo + 6, k, 1, 1); }
  }
}

/* ---------------------------------------------------------- router */

function go(screen, opts) {
  opts = opts || {};
  state.railIndex = state._pendingRail;
  state._pendingRail = null;
  if (state.screen !== screen && !opts.replace) state.stack.push(state.screen);
  state.screen = screen;
  closeSheets();
  $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.dataset.screen === screen); });
  var active = $('.screen[data-screen="' + screen + '"]');
  if (active) active.scrollTop = 0;

  var bare = NO_CHROME.indexOf(screen) >= 0;
  $('#tabbar').classList.toggle('is-hidden', bare);
  $('#fabQr').classList.toggle('is-hidden', bare);
  var dark = DARK_TOP.indexOf(screen) >= 0;
  $('#statusbar').classList.toggle('on-dark', dark);
  $('#device').classList.toggle('on-dark', ['locked', 'push', 'fuelling'].indexOf(screen) >= 0);

  var tab = active ? active.dataset.tab : null;
  $$('.tab').forEach(function (b) { b.classList.toggle('is-active', !!tab && b.dataset.go === tab); });

  if (screen === 'fuelling') startFuelling();
  else stopFuelling();
  if (screen === 'redemption') startRedemptionTimer();
  else stopRedemptionTimer();
  if (screen === 'card') renderCardBars();

  syncRail();
  renderState();
}

function back() {
  var prev = state.stack.pop();
  go(prev || 'home', { replace: true });
}

/* ---------------------------------------------------------- sheets & toast */

function openSheet(id) {
  var s = $('.sheet-backdrop[data-sheetid="' + id + '"]');
  if (!s) return;
  closeSheets();
  s.classList.add('is-open');
  if (id === 'qr') drawQR($('canvas[data-qr="member"]'), 'DSC48217730');
  if (id === 'history') renderHistory();
}
function closeSheets() { $$('.sheet-backdrop').forEach(function (s) { s.classList.remove('is-open'); }); }

var toastTimer = null;
function toast(key) {
  var box = $('#toast');
  var entry = TOASTS[key];
  box.textContent = entry ? entry[state.lang] : key;
  box.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { box.classList.remove('is-open'); }, 2600);
}

/* ---------------------------------------------------------- review rail */

function buildRail() {
  var list = $('#railList'), group = null;
  SCREENS.forEach(function (row, i) {
    if (row.g) {
      group = el('div', 'rail__group');
      group.appendChild(el('h2', null, row.g));
      list.appendChild(group);
      return;
    }
    var b = el('button', 'rail__item', '<i>' + row.n + '</i><span>' + row.t + '</span>');
    b.type = 'button';
    b.dataset.rail = String(i);
    group.appendChild(b);
  });
}

function railEntryFor(screen) {
  for (var i = 0; i < SCREENS.length; i++) {
    if (SCREENS[i].s === screen) return i;
  }
  return -1;
}

function syncRail() {
  var idx = state.railIndex != null ? state.railIndex : railEntryFor(state.screen);
  $$('.rail__item').forEach(function (b) { b.classList.toggle('is-active', Number(b.dataset.rail) === idx); });
  var row = SCREENS[idx];
  if (!row || row.g) return;
  var epic = '';
  for (var i = idx; i >= 0; i--) { if (SCREENS[i].g) { epic = SCREENS[i].epic; break; } }
  $('#noteStep').textContent = 'Screen ' + row.n + ' of 24';
  $('#noteTitle').textContent = row.t;
  $('#noteEpic').textContent = epic;
  $('#noteBody').textContent = row.note;
  $('#noteHint').textContent = HINTS[row.s] || 'Every control on this screen is live. Follow the primary action to move on.';
}

var HINTS = {
  welcome: 'Tap Join to start the OTP flow.',
  mobile: 'Use the on-screen keypad, or tap “demo” to fill a valid number.',
  otp: 'Any six digits sign you in — the sixth submits on its own.',
  consent: 'The two required switches are locked; only marketing moves.',
  biometric: 'Both paths continue — Face ID is genuinely optional.',
  locked: 'Tap the face target or Unlock to pass the check.',
  home: 'Quick actions, the ranked feed and the nearest station are all live.',
  push: 'Tap the notification to open the offer it points at.',
  offer: 'The two grey blocks are the PDPL transparency requirement.',
  stations: 'Filters and pins both drive the list. Pick a station to continue.',
  station: 'Grey pumps are in use and cannot be selected.',
  authorise: 'Change grade to see the pump price follow through to the receipt.',
  fuelling: 'Runs live. Stop early or let it finish — both reach the receipt.',
  receipt: 'The nudge below the receipt is the redemption driver.',
  cafe: 'Steppers update the earn and the pay bar together.',
  pickup: 'Points have already posted to the balance in the header.',
  card: 'Both wallet buttons are live; the pass mirrors the balance.',
  rewards: 'Reachable-now items sort first; locked ones show the gap.',
  reward: 'Balance-after is stated before the commitment, never after.',
  redemption: 'The timer is real — thirty minutes, then it lapses cleanly.',
  account: 'Language, consent and deletion all live in one place.',
  prefs: 'Turning marketing consent off here withdraws it everywhere.'
};

function runRail(idx) {
  var row = SCREENS[idx];
  if (!row || row.g) return;
  switch (row.act) {
    case 'offer0': state.offer = OFFERS[0]; renderOffer(); break;
    case 'station0': state.station = 0; renderStation(); break;
    case 'pump3': state.station = 0; state.pump = 3; renderStation(); break;
    case 'cafe2': state.cafe = { flat: 1, date: 1 }; renderCafe(); placeOrder(true); break;
    case 'reward0': state.reward = REWARDS[0]; renderReward(); if (row.s === 'redemption') makeRedemption(true); break;
    case 'ar': setLang('ar'); break;
    default: break;
  }
  state._pendingRail = idx;
  go(row.s);
  if (row.act === 'qr') openSheet('qr');
}

/* ---------------------------------------------------------- onboarding */

function renderPhone() {
  var d = state.phone, out = '';
  for (var i = 0; i < 9; i++) {
    out += (i < d.length ? d[i] : '·');
    if (i === 1 || i === 4 || i === 6) out += ' ';
  }
  $('#phoneDigits').textContent = out;
  $('#phoneContinue').disabled = d.length < 9;
  $('#otpTarget').textContent = '+966 ' + (d.slice(0, 2) || '51') + ' ' + (d.slice(2, 5) || '234') + ' ' + (d.slice(5) || '5678');
}

function renderOtp() {
  $$('#otpBoxes .otpbox').forEach(function (b, i) {
    b.textContent = state.otp[i] || '';
    b.classList.toggle('is-focus', i === state.otp.length);
  });
}

/* ---------------------------------------------------------- home feed */

function renderFeed() {
  var wrap = $('#offerFeed');
  wrap.innerHTML = '';
  OFFERS.forEach(function (o, i) {
    var b = el('button', 'offercard');
    b.dataset.offer = o.id;
    b.innerHTML =
      '<span class="art" style="background:' + o.art + '">' +
        '<span class="rank">#' + (i + 1) + '</span>' +
        '<svg width="34" height="34" style="opacity:.9"><use href="#' + (o.id === 'cafe3x' ? 'i-coffee' : o.id === 'wash900' ? 'i-wash' : o.id === 'f1' ? 'i-star' : 'i-gift') + '"/></svg>' +
      '</span>' +
      '<span class="body"><h4>' + t('offer.' + o.id + '.title', o.title) + '</h4><p>' + t('offer.' + o.id + '.short', o.short) + '</p></span>';
    wrap.appendChild(b);
  });
}

/* ---------------------------------------------------------- offer detail */

var OFFER_ICON = { cafe3x: 'i-coffee', wash900: 'i-wash', f1: 'i-star', store: 'i-gift' };

function renderOffer() {
  var o = state.offer;
  var art = $('#offerArt');
  art.style.background = o.art;
  $('#offerArtIcon').innerHTML = '<svg width="70" height="70"><use href="#' + (OFFER_ICON[o.id] || 'i-gift') + '"/></svg>';
  $('#offerRank').textContent = o.rank;
  $('#offerExpiry').innerHTML = '<svg width="12" height="12"><use href="#i-clock"/></svg> ' + o.expiry;
  $('#offerTitle').textContent = o.title;
  $('#offerBody').textContent = o.body;
  $('#offerWhy').textContent = o.why;
  $('#offerWho').textContent = o.who;
  $('#offerEarn').textContent = o.earn;
  $('#offerValid').textContent = o.valid;
  $('#offerWhere').textContent = o.where;
}

function openOffer(id) {
  var found = OFFERS.filter(function (o) { return o.id === id; })[0];
  state.offer = found || OFFERS[0];
  renderOffer();
  go('offer');
}

/* ---------------------------------------------------------- stations */

var stationFilter = 'all';

function stationCard(s, i, small) {
  var b = el('button', 'stationcard' + (small ? ' stationcard--sm' : ''));
  if (!small) b.style.margin = '0 0 10px';
  b.dataset.station = String(i);
  b.innerHTML =
    '<span class="info">' +
      '<span class="nm">' + t('st.' + i, s.name) + '</span>' +
      '<span class="meta"><svg width="' + (small ? 11 : 13) + '" height="' + (small ? 11 : 13) + '"><use href="#i-pin"/></svg> <span class="nums">' + s.dist + '</span></span>' +
      '<span class="meta"><svg width="' + (small ? 11 : 13) + '" height="' + (small ? 11 : 13) + '"><use href="#i-drop"/></svg> <span class="nums">' + s.free + '</span> ' + t('sl.of', 'of') + ' <span class="nums">' + s.total + '</span> ' + t('st.free', 'pumps free') + '</span>' +
      '<span class="mins"><b class="nums">' + s.min + '</b><span>' + t('st.mins', 'Minutes<br>away') + '</span></span>' +
      '<span class="link">' + t('st.takeme', 'Take me there') + ' <svg width="' + (small ? 11 : 13) + '" height="' + (small ? 11 : 13) + '"><use href="#i-arrow"/></svg></span>' +
    '</span>' +
    '<span class="photo"><svg viewBox="0 0 240 180" preserveAspectRatio="xMidYMid slice"><use href="#' + s.img + '"/></svg></span>';
  return b;
}

function renderStationList() {
  var wrap = $('#stationList');
  var home = $('#homeStations');
  wrap.innerHTML = '';
  home.innerHTML = '';
  STATIONS.forEach(function (s, i) {
    if (i < 2) home.appendChild(stationCard(s, i, true));
    if (stationFilter !== 'all' && s.tags.indexOf(stationFilter) < 0) return;
    wrap.appendChild(stationCard(s, i, false));
  });
  if (!wrap.children.length) wrap.appendChild(el('p', 'small muted center', state.lang === 'ar' ? 'لا توجد محطات مطابقة.' : 'No stations match that filter.'));
}

function renderStation() {
  var s = STATIONS[state.station];
  $('#stationHero').innerHTML = '<use href="#' + s.img + '"/>';
  $('#stationName').textContent = t('st.' + state.station, s.name);
  $('#stationDist').textContent = s.dist;
  $('#stationFree').innerHTML = '<span class="nums">' + s.free + '</span>/<span class="nums">' + s.total + '</span> ' + t('st.free', 'pumps free');
  var grid = $('#pumpGrid');
  grid.innerHTML = '';
  s.pumps.forEach(function (p) {
    var b = el('button', 'pumpbtn' + (p.busy ? ' is-busy' : '') + (state.pump === p.n && !p.busy ? ' is-sel' : ''));
    b.dataset.pumpno = String(p.n);
    b.innerHTML = '<span class="nums">' + p.n + '</span><small>' + (p.busy ? (state.lang === 'ar' ? 'مشغولة' : 'In use') : (state.lang === 'ar' ? 'متاحة' : 'Free')) + '</small>';
    if (p.busy) b.disabled = true;
    grid.appendChild(b);
  });
  $('#pumpContinue').disabled = state.pump == null;
}

/* ---------------------------------------------------------- fuelling */

function startFuelling() {
  stopFuelling();
  var price = PRICES[state.grade];
  var target = 96.00;
  var start = null, dur = 8200;
  $('#fuelState').textContent = t('fu.running', 'Fuelling');
  function step(ts) {
    if (!start) start = ts;
    var k = Math.min(1, (ts - start) / dur);
    var eased = 1 - Math.pow(1 - k, 1.6);
    state.fuel.amount = target * eased;
    state.fuel.litres = state.fuel.amount / price;
    state.fuel.points = Math.round(state.fuel.amount);
    $('#fuelAmount').textContent = money(state.fuel.amount);
    $('#fuelLitres').textContent = money(state.fuel.litres);
    $('#fuelPoints').textContent = fmt(state.fuel.points);
    $('#fuelRing').style.strokeDashoffset = (276.5 * (1 - eased)).toFixed(1);
    if (k < 1) state.fuel.timer = requestAnimationFrame(step);
    else { state.fuel.timer = null; setTimeout(function () { if (state.screen === 'fuelling') finishFuelling(); }, 700); }
  }
  state.fuel.amount = 0; state.fuel.litres = 0; state.fuel.points = 0;
  $('#fuelRing').style.strokeDashoffset = '276.5';
  state.fuel.timer = requestAnimationFrame(step);
}

function stopFuelling() {
  if (state.fuel.timer) { cancelAnimationFrame(state.fuel.timer); state.fuel.timer = null; }
}

function finishFuelling() {
  stopFuelling();
  var pts = Math.max(1, Math.round(state.fuel.amount));
  state.points += pts;
  commitVisit();
  $('#recAmount').textContent = money(state.fuel.amount);
  $('#recLitres').textContent = state.fuel.litres.toFixed(1);
  $('#recLitres2').textContent = state.fuel.litres.toFixed(1);
  $('#recPoints').textContent = fmt(pts);
  $('#recPoints2').textContent = fmt(pts);
  go('receipt');
}

/* ---------------------------------------------------------- cafe */

function renderCafe() {
  var wrap = $('#cafeMenu');
  wrap.innerHTML = '';
  CAFE.forEach(function (item) {
    var q = state.cafe[item.id] || 0;
    var row = el('div', 'rewardcard');
    row.innerHTML =
      '<span class="art" style="background:' + item.art + '"><svg width="26" height="26"><use href="#' + (item.icon || 'i-coffee') + '"/></svg></span>' +
      '<span class="grow">' +
        '<h4>' + t('cafe.' + item.id, item.name) + '</h4>' +
        '<div class="tiny muted"><span class="nums">' + money(item.price) + '</span> SAR · <span style="color:var(--ok);font-weight:600">+<span class="nums">' + item.pts + '</span> ' + t('pts', 'PTS') + '</span></div>' +
      '</span>' +
      '<span class="stepper">' +
        (q > 0 ? '<button data-cafe-minus="' + item.id + '">−</button><span class="nums">' + q + '</span>' : '') +
        '<button class="is-primary" data-cafe-plus="' + item.id + '">+</button>' +
      '</span>';
    wrap.appendChild(row);
  });
  var count = 0, total = 0, pts = 0;
  CAFE.forEach(function (i) { var q = state.cafe[i.id] || 0; count += q; total += q * i.price; pts += q * i.pts; });
  $('#cafeCount').textContent = fmt(count);
  $('#cafeTotal').textContent = money(total);
  $('#cafePts').textContent = fmt(pts);
  $('#cafePay').disabled = count === 0;
  return { count: count, total: total, pts: pts };
}

function placeOrder(silent) {
  var sums = renderCafe();
  if (!sums.count) return;
  state.points += sums.pts;
  commitVisit();
  $('#pkLines').textContent = fmt(sums.count);
  $('#pkTotal').textContent = money(sums.total);
  $('#pkPoints').textContent = fmt(sums.pts);
  drawQR($('canvas[data-qr="member"]'), 'DSC48217730');
  if (!silent) go('pickup');
  renderState();
}

/* ---------------------------------------------------------- rewards */

var rewardFilter = 'all';

function renderRewards() {
  var wrap = $('#rewardList');
  wrap.innerHTML = '';
  var list = REWARDS.slice().filter(function (r) {
    if (rewardFilter === 'all') return true;
    if (rewardFilter === 'now') return r.cost <= state.points;
    return r.cat === rewardFilter;
  });
  list.sort(function (a, b) {
    var an = a.cost <= state.points ? 0 : 1, bn = b.cost <= state.points ? 0 : 1;
    return an - bn || a.cost - b.cost;
  });
  var reachable = REWARDS.filter(function (r) { return r.cost <= state.points; }).length;
  $('.screen[data-screen="rewards"] [data-i18n="rw.reach"]').textContent =
    state.lang === 'ar'
      ? (reachable + ' مكافآت في متناولك اليوم.')
      : (reachable + ' rewards are within reach today.');

  list.forEach(function (r) {
    var locked = r.cost > state.points;
    var b = el('button', 'rewardcard' + (locked ? ' is-locked' : ''));
    b.dataset.reward = r.id;
    var pct = Math.min(100, Math.round(state.points / r.cost * 100));
    b.innerHTML =
      '<span class="art" style="background:' + r.art + '"><svg width="26" height="26"><use href="#' + (r.icon || (r.cat === 'cafe' ? 'i-coffee' : r.cat === 'wash' ? 'i-wash' : 'i-fuel')) + '"/></svg></span>' +
      '<span class="grow">' +
        '<h4>' + t('rw.' + r.id, r.name) + '</h4>' +
        '<div class="tiny" style="color:' + (locked ? 'var(--ink-3)' : 'var(--ok)') + ';font-weight:600"><span class="nums">' + fmt(r.cost) + '</span> ' + t('pts', 'PTS') + '</div>' +
        (locked
          ? '<span class="track track--light" style="margin-top:7px"><span style="width:' + pct + '%"></span></span>' +
            '<div class="tiny muted" style="margin-top:5px"><span class="nums">' + fmt(r.cost - state.points) + '</span> ' + (state.lang === 'ar' ? 'نقطة متبقية' : 'points to go') + '</div>'
          : '<span class="chip chip--green" style="margin-top:6px">' + (state.lang === 'ar' ? 'متاحة الآن' : 'Reachable now') + '</span>') +
      '</span>' +
      '<svg width="18" height="18" class="muted"><use href="#' + (locked ? 'i-lock' : 'i-chev') + '"/></svg>';
    wrap.appendChild(b);
  });
}

function renderReward() {
  var r = state.reward, locked = r.cost > state.points;
  $('#rewardArt').style.background = r.art;
  $('#rewardArtIcon').innerHTML = '<svg width="66" height="66"><use href="#' +
    (r.icon || (r.cat === 'cafe' ? 'i-coffee' : r.cat === 'wash' ? 'i-wash' : 'i-fuel')) + '"/></svg>';
  $('#rewardTitle').textContent = t('rw.' + r.id, r.name);
  $('#rewardBody').textContent = r.body;
  $('#rdCost').textContent = fmt(r.cost);
  $('#rdAfter').textContent = locked ? '—' : fmt(state.points - r.cost);
  var pct = Math.min(100, Math.round(state.points / r.cost * 100));
  $('#rdTrack').style.width = pct + '%';
  $('#rdTrackNote').textContent = locked
    ? (state.lang === 'ar'
        ? ('تحتاج ' + fmt(r.cost - state.points) + ' نقطة إضافية — نحو ' + Math.ceil((r.cost - state.points) / 150) + ' زيارات.')
        : (fmt(r.cost - state.points) + ' points to go — about ' + Math.ceil((r.cost - state.points) / 150) + ' more stops.'))
    : t('rd.enough', 'You have enough — this burns on your next visit.');
  $('#rewardRedeem').disabled = locked;
  $('#rewardRedeem').textContent = locked
    ? (state.lang === 'ar' ? 'ليس بعد' : 'Not yet reachable')
    : t('rd.cta', 'Redeem now');
}

function makeRedemption(silent) {
  var r = state.reward;
  if (r.cost > state.points) return;
  state.points -= r.cost;
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  state.redemption = { code: code.slice(0, 3) + ' ' + code.slice(3), until: Date.now() + 30 * 60 * 1000 };
  $('#rcCode').textContent = state.redemption.code;
  $('#rcTitle').textContent = t('rw.' + r.id, r.name);
  $('#rcCost').textContent = fmt(r.cost);
  $('#rcAfter').textContent = fmt(state.points);
  drawQR($('canvas[data-qr="redeem"]'), code + r.id);
  renderState();
  if (!silent) go('redemption');
}

var rcTimer = null;
function startRedemptionTimer() {
  stopRedemptionTimer();
  if (!state.redemption) return;
  function tick() {
    var left = Math.max(0, state.redemption.until - Date.now());
    var m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
    $('#rcTimer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }
  tick();
  rcTimer = setInterval(tick, 1000);
}
function stopRedemptionTimer() { if (rcTimer) { clearInterval(rcTimer); rcTimer = null; } }

/* ---------------------------------------------------------- misc renderers */

function renderCardBars() {
  var wrap = $('#cardBars');
  if (wrap.childElementCount) return;
  for (var i = 0; i < 44; i++) {
    var bar = el('i');
    bar.style.height = (28 + ((i * 37) % 70)) + '%';
    bar.style.opacity = (i % 3 === 0 ? '.55' : '.95');
    wrap.appendChild(bar);
  }
}

function renderHistory() {
  var wrap = $('#historyList');
  wrap.innerHTML = '';
  var group = el('div', 'listgroup');
  group.style.margin = '0 0 14px';
  HISTORY.forEach(function (h) {
    var row = el('button', 'listrow');
    row.innerHTML =
      '<span class="lead"><svg width="18" height="18"><use href="#' + (h.p[0] === '−' ? 'i-gift' : 'i-receipt') + '"/></svg></span>' +
      '<span class="grow"><b style="font-size:13.5px">' + h.t + '</b><div class="tiny muted nums">' + h.d + ' · ' + h.a + '</div></span>' +
      '<b class="nums" style="color:' + (h.p[0] === '−' ? 'var(--ink-3)' : 'var(--ok)') + '">' + h.p + '</b>';
    group.appendChild(row);
  });
  wrap.appendChild(group);
}

/* ---------------------------------------------------------- events */

document.addEventListener('click', function (ev) {
  var n;

  /* review rail */
  n = ev.target.closest('[data-rail]');
  if (n) { runRail(Number(n.dataset.rail)); return; }

  /* sheets */
  n = ev.target.closest('[data-sheet]');
  if (n) { openSheet(n.dataset.sheet); return; }
  if (ev.target.closest('[data-close]')) { closeSheets(); return; }
  if (ev.target.classList.contains('sheet-backdrop')) { closeSheets(); return; }

  /* toasts */
  n = ev.target.closest('[data-toast]');
  if (n) { toast(n.dataset.toast); return; }

  /* scroll to a section on the same screen */
  n = ev.target.closest('[data-scroll]');
  if (n) {
    var target = document.getElementById(n.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  /* navigation */
  if (ev.target.closest('[data-back]')) { back(); return; }
  n = ev.target.closest('[data-go]');
  if (n) {
    var dest = n.dataset.go;
    if (dest === 'rewards') renderRewards();
    if (dest === 'stations') renderStationList();
    if (dest === 'station') renderStation();
    if (dest === 'cafe') renderCafe();
    go(dest);
    return;
  }

  /* keypads */
  n = ev.target.closest('#keypad [data-k]');
  if (n) {
    var k = n.dataset.k;
    if (k === 'del') state.phone = state.phone.slice(0, -1);
    else if (k === 'fill') state.phone = '512345678';
    else if (state.phone.length < 9) state.phone += k;
    renderPhone();
    return;
  }
  n = ev.target.closest('#keypadOtp [data-k]');
  if (n) {
    var ko = n.dataset.k;
    if (ko === 'del') state.otp = state.otp.slice(0, -1);
    else if (ko === 'fill') state.otp = '418206';
    else if (state.otp.length < 6) state.otp += ko;
    renderOtp();
    if (state.otp.length === 6) setTimeout(function () { go('consent'); }, 320);
    return;
  }
  if (ev.target.closest('#phoneContinue')) { state.otp = ''; renderOtp(); go('otp'); return; }
  if (ev.target.closest('#otpResend')) { toast(state.lang === 'ar' ? 'أُرسل رمز جديد.' : 'A new code is on its way.'); return; }

  /* consent + toggles */
  n = ev.target.closest('[data-consent]');
  if (n) {
    if (n.classList.contains('is-locked')) { toast('toast.locked'); return; }
    var key = n.dataset.consent;
    state.consent[key] = !state.consent[key];
    $$('[data-consent="' + key + '"]').forEach(function (s) { s.classList.toggle('is-on', state.consent[key]); });
    return;
  }
  n = ev.target.closest('[data-toggle]');
  if (n) { n.classList.toggle('is-on'); return; }

  /* biometrics + lock */
  if (ev.target.closest('#bioOn')) { state.biometrics = true; go('locked'); return; }
  if (ev.target.closest('#faceUnlock') || ev.target.closest('#faceTarget')) {
    var face = $('#faceTarget');
    face.classList.add('is-scanning');
    setTimeout(function () { face.classList.remove('is-scanning'); renderFeed(); go('home'); }, 900);
    return;
  }

  /* home + offers */
  n = ev.target.closest('[data-offer]');
  if (n) { openOffer(n.dataset.offer); return; }
  if (ev.target.closest('#pushOpen')) { openOffer('cafe3x'); return; }

  /* stations */
  n = ev.target.closest('[data-station]');
  if (n) { state.station = Number(n.dataset.station); state.pump = null; renderStation(); go('station'); return; }
  n = ev.target.closest('[data-filter]');
  if (n) {
    stationFilter = n.dataset.filter;
    $$('[data-filter]').forEach(function (b) { b.classList.toggle('is-on', b === n); });
    renderStationList();
    return;
  }
  n = ev.target.closest('[data-pumpno]');
  if (n) {
    state.pump = Number(n.dataset.pumpno);
    renderStation();
    return;
  }
  if (ev.target.closest('#pumpContinue')) { go('authorise'); return; }

  /* authorise */
  n = ev.target.closest('[data-grade]');
  if (n) {
    state.grade = n.dataset.grade;
    $$('[data-grade] .radio').forEach(function (r) { r.classList.remove('is-on'); });
    $('.radio', n).classList.add('is-on');
    renderState();
    return;
  }

  /* fuelling */
  if (ev.target.closest('#fuelStop')) { finishFuelling(); return; }

  /* cafe */
  n = ev.target.closest('[data-cafe-plus]');
  if (n) { var idp = n.dataset.cafePlus; state.cafe[idp] = (state.cafe[idp] || 0) + 1; renderCafe(); return; }
  n = ev.target.closest('[data-cafe-minus]');
  if (n) { var idm = n.dataset.cafeMinus; state.cafe[idm] = Math.max(0, (state.cafe[idm] || 0) - 1); renderCafe(); return; }
  if (ev.target.closest('#cafePay')) { placeOrder(false); return; }

  /* rewards */
  n = ev.target.closest('[data-rfilter]');
  if (n) {
    rewardFilter = n.dataset.rfilter;
    $$('[data-rfilter]').forEach(function (b) { b.classList.toggle('is-on', b === n); });
    renderRewards();
    return;
  }
  n = ev.target.closest('[data-reward]');
  if (n) {
    state.reward = REWARDS.filter(function (r) { return r.id === n.dataset.reward; })[0];
    renderReward();
    go('reward');
    return;
  }
  if (ev.target.closest('#rewardRedeem')) { makeRedemption(false); return; }

  /* preferences */
  n = ev.target.closest('[data-channel]');
  if (n) {
    state.channel = n.dataset.channel;
    $$('[data-channel] .radio').forEach(function (r) { r.classList.remove('is-on'); });
    $('.radio', n).classList.add('is-on');
    return;
  }
  n = ev.target.closest('[data-cap]');
  if (n) {
    state.cap = Math.min(7, Math.max(0, state.cap + (n.dataset.cap === '+' ? 1 : -1)));
    $('#capValue').textContent = fmt(state.cap);
    return;
  }

  /* language + chrome */
  if (ev.target.closest('#langRow') || ev.target.closest('#langRow2')) {
    setLang(state.lang === 'en' ? 'ar' : 'en');
    closeSheets();
    return;
  }
  if (ev.target.closest('#fabQr')) { openSheet('qr'); return; }
  if (ev.target.closest('#btnLang')) { setLang(state.lang === 'en' ? 'ar' : 'en'); return; }
  if (ev.target.closest('#btnNotes')) {
    state.notes = !state.notes;
    $('#notes').style.display = state.notes ? '' : 'none';
    $('#btnNotes').classList.toggle('is-on', state.notes);
    return;
  }
  if (ev.target.closest('#btnReset')) { location.reload(); return; }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeSheets();
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    var items = $$('.rail__item');
    var cur = items.findIndex(function (b) { return b.classList.contains('is-active'); });
    var next = cur + (e.key === 'ArrowRight' ? 1 : -1);
    if (next >= 0 && next < items.length) { items[next].click(); e.preventDefault(); }
  }
});

/* ---------------------------------------------------------- boot */

buildRail();
renderPhone();
renderOtp();
renderFeed();
renderStationList();
renderStation();
renderCafe();
renderRewards();
renderReward();
applyLang();
go('welcome', { replace: true });
state.stack = [];

})();
