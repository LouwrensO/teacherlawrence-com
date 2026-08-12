/* ============================================================
   ESL LEARNER — lesson library (hand-written starter set)
   Each lesson uses the same shape the renderer expects, plus a
   few extra fields for the library cards (id, level, category,
   icon, summary).

   Levels: elementary · intermediate · upper · advanced
   To add a lesson, copy a block and change the fields. The word
   search, scramble and answer key build themselves from "vocab".
   ============================================================ */

/* the learning ladder — phonics right through to super-advanced */
const LEVELS = [
  { key:"phonics",      label:"Phonics & Starter", meta:"Phonics & Starter · Pre-A1 · ~30 min",  tag:"Starter · Pre-A1" },
  { key:"beginner",     label:"Beginner",          meta:"Beginner · CEFR A1 · ~35 min",          tag:"Beginner · A1" },
  { key:"elementary",   label:"Elementary",        meta:"Elementary · CEFR A2 · ~40 min",        tag:"Elementary · A2" },
  { key:"pre-int",      label:"Pre-Intermediate",  meta:"Pre-Intermediate · CEFR A2–B1 · ~45 min",tag:"Pre-Int · A2–B1" },
  { key:"intermediate", label:"Intermediate",      meta:"Intermediate · CEFR B1 · ~50 min",      tag:"Intermediate · B1" },
  { key:"upper",        label:"Upper-Intermediate",meta:"Upper-Intermediate · CEFR B2 · ~55 min",tag:"Upper-Int · B2" },
  { key:"advanced",     label:"Advanced",          meta:"Advanced · CEFR C1 · ~60 min",          tag:"Advanced · C1" },
  { key:"super",        label:"Super-Advanced",    meta:"Super-Advanced · CEFR C2 · ~65 min",    tag:"Super-Adv · C2" }
];

/* topic tags for browsing (a lesson's category maps to one of these) */
const TOPICS = ["Starter","Nature","Science","People","Daily Life","Society","Culture"];
// "Bible" is deliberately NOT in the list above — it's appended separately
// (see public/index.html / public/path.html) so it's always last in the
// chip row, but it IS shown by default to every visitor, logged in or out,
// and is free regardless of subscription (public/lesson.html's
// dlDetermineAccess()). A signed-in user can opt OUT for their own account
// via the hide_bible_topic preference — see api/access.js / save-profile.js.
const BIBLE_TOPIC = "Bible";
const TOPIC_OF_CATEGORY = {
  "Phonics":"Starter", "First Words":"Starter", "Food":"Starter", "School":"Starter",
  "Nature":"Nature", "Conservation":"Nature",
  "Science":"Science", "Technology":"Science",
  "Biography":"People",
  "Daily Life":"Daily Life", "Community":"Daily Life", "Food & History":"Daily Life",
  "Society":"Society",
  "Culture":"Culture",
  "Bible":"Bible"
};
function topicOf(lesson){ return lesson.topic || TOPIC_OF_CATEGORY[lesson.category] || "Other"; }

/* ---- the ONE canonical lesson order — the locked Path walks this exact
   sequence, low level to high, and it's also used for "next lesson"
   elsewhere. Level order first, then a lesson's own `seq` (multi-part
   series generated together), then title as a stable final tiebreaker.
   Shared here (rather than re-implemented per page) so path.html and
   lesson.html can never disagree about what "next" means. ---- */
const LEVEL_ORDER = LEVELS.map(l=>l.key);
function dlOrderedLessons(list){
  return (list||[]).slice().sort((a,b)=>
    (LEVEL_ORDER.indexOf(a.level)-LEVEL_ORDER.indexOf(b.level))
    || ((a.seq==null?999:a.seq)-(b.seq==null?999:b.seq))
    || (a.title>b.title?1:(a.title<b.title?-1:0)));
}
/* the flat, ordered list of every lesson a student can be walked through —
   private "Create Your Own" lessons are excluded since they're not part of
   anyone else's path. */
function dlPathList(list){
  return dlOrderedLessons((list||[]).filter(x=>x.visibility!=='private'));
}
/* a student's current unlocked lesson: the first lesson in path order that
   isn't done yet, or the last lesson if everything is done. `stateOf(id)`
   is the caller's own progress lookup (path.html/lesson.html each already
   have one) returning 'done' | 'in_progress' | 'none'. */
function dlCurrentPathLessonId(flatList, stateOf){
  const notDone = (flatList||[]).find(x=>stateOf(x.id)!=='done');
  return notDone ? notDone.id : ((flatList&&flatList.length) ? flatList[flatList.length-1].id : null);
}
/* one level's slice of the path, in the same canonical order — the locked
   path is scoped to a student's currently active level (see path.html's
   level switcher) rather than walking the whole 8-level ladder at once.
   dlCurrentPathLessonId() (above) called with THIS list gives each level
   its own independent "next lesson" cursor for free, since lesson_progress
   is already keyed per lesson id and every lesson has exactly one level. */
function dlLevelPathList(list, levelKey){
  return dlPathList(list).filter(x=>x.level===levelKey);
}

/* Is the current visitor on the locked, one-activity-at-a-time learner path
   (as opposed to a teacher/guest freely browsing)? Shared by path.html and
   lesson.html so both pages agree — a signup with no role picker (see
   onboard.html) defaults everyone here. */
function dlIsStudent(){ return localStorage.getItem('dl_role') === 'student'; }

/* The owner's real, server-verified email (see public/account.js and
   api/save-profile.js for the same constant — duplicated per-file by this
   codebase's existing convention rather than shared). */
const DL_OWNER_EMAIL = "louwrensoberholzer@gmail.com";
function dlIsOwnerEmail(email){ return !!email && String(email).toLowerCase() === DL_OWNER_EMAIL; }

/* Owner-only QA bypass: true only once a page has independently verified,
   via dlCheckAccess()'s server-side email (not just localStorage), that the
   signed-in user is the owner AND the owner has the nav "Preview" toggle on
   (see account.js). Pages set window.DL_OWNER_PREVIEW themselves once their
   own async check resolves — this stays a plain synchronous read so it can
   be used inside render()/gate functions. */
function dlOwnerPreviewActive(){ return window.DL_OWNER_PREVIEW === true; }

/* Is real lock/gate enforcement active right now? Distinct from
   dlIsStudent() (which still drives chrome-stripping even while the owner
   is previewing) — this is the one thing path.html's lock rendering and
   lesson.html's slide gate should both check. */
function dlGateActive(){ return dlIsStudent() && !dlOwnerPreviewActive(); }

var LESSONS = [

/* ===================== BEGINNER (Pre-A1) — flashcard lessons =====================
   A different lesson TYPE: picture + word cards with audio, plus a
   matching game. No reading passage. Shape:
     { type:"flashcards", cards:[{word, emoji, letter?}], practise:[...] } */
{
  id:"the-alphabet", level:"phonics", type:"flashcards", category:"Phonics", icon:"🔤",
  title:"The Alphabet", kicker:"Phonics · Starter",
  summary:"A to Z — each letter with a picture word to say out loud.",
  intro:"Let's learn the letters of the alphabet, from A to Z!",
  cards:[
    {letter:"A", word:"Apple", emoji:"🍎", ko:"사과"}, {letter:"B", word:"Ball", emoji:"⚽", ko:"공"},
    {letter:"C", word:"Cat", emoji:"🐱", ko:"고양이"},   {letter:"D", word:"Dog", emoji:"🐶", ko:"개"},
    {letter:"E", word:"Egg", emoji:"🥚", ko:"달걀"},   {letter:"F", word:"Fish", emoji:"🐟", ko:"물고기"},
    {letter:"G", word:"Grapes", emoji:"🍇", ko:"포도"},{letter:"H", word:"Hat", emoji:"🎩", ko:"모자"},
    {letter:"I", word:"Ice cream", emoji:"🍦", ko:"아이스크림"},{letter:"J", word:"Juice", emoji:"🧃", ko:"주스"},
    {letter:"K", word:"Kite", emoji:"🪁", ko:"연"},  {letter:"L", word:"Lion", emoji:"🦁", ko:"사자"},
    {letter:"M", word:"Moon", emoji:"🌙", ko:"달"},  {letter:"N", word:"Net", emoji:"🥅", ko:"그물"},
    {letter:"O", word:"Orange", emoji:"🍊", ko:"오렌지"},{letter:"P", word:"Pig", emoji:"🐷", ko:"돼지"},
    {letter:"Q", word:"Queen", emoji:"👑", ko:"여왕"}, {letter:"R", word:"Rainbow", emoji:"🌈", ko:"무지개"},
    {letter:"S", word:"Sun", emoji:"☀️", ko:"해"},   {letter:"T", word:"Tree", emoji:"🌳", ko:"나무"},
    {letter:"U", word:"Umbrella", emoji:"☂️", ko:"우산"},{letter:"V", word:"Van", emoji:"🚐", ko:"승합차"},
    {letter:"W", word:"Whale", emoji:"🐳", ko:"고래"}, {letter:"X", word:"Fox", emoji:"🦊", ko:"여우"},
    {letter:"Y", word:"Yo-yo", emoji:"🪀", ko:"요요"}, {letter:"Z", word:"Zebra", emoji:"🦓", ko:"얼룩말"}
  ],
  practise:["Can you say the alphabet from A to Z?","What is the first letter of your name?","Say a word that starts with B."]
},
{
  id:"colours", level:"phonics", type:"flashcards", category:"First Words", icon:"🎨",
  title:"Colours", kicker:"First Words · Starter",
  summary:"Name the colours: red, blue, green, yellow and more.",
  intro:"Let's learn the colours!",
  cards:[
    {word:"Red", emoji:"🔴", ko:"빨간색"}, {word:"Blue", emoji:"🔵", ko:"파란색"}, {word:"Green", emoji:"🟢", ko:"초록색"},
    {word:"Yellow", emoji:"🟡", ko:"노란색"}, {word:"Orange", emoji:"🟠", ko:"주황색"}, {word:"Purple", emoji:"🟣", ko:"보라색"},
    {word:"Pink", emoji:"💗", ko:"분홍색"}, {word:"Brown", emoji:"🟤", ko:"갈색"}, {word:"Black", emoji:"⚫", ko:"검은색"},
    {word:"White", emoji:"⚪", ko:"흰색"}
  ],
  read:[
    {say:"I see a red apple and a yellow sun.", html:"I see a 🔴 <b>red</b> apple and a 🟡 <b>yellow</b> sun.", ko:"나는 빨간 사과와 노란 해를 봐요."},
    {say:"The green tree and the blue sky.", html:"The 🟢 <b>green</b> tree and the 🔵 <b>blue</b> sky.", ko:"초록 나무와 파란 하늘."},
    {say:"The cat is black and white.", html:"The 🐱 cat is ⚫ <b>black</b> and ⚪ <b>white</b>.", ko:"고양이는 검은색과 흰색이에요."}
  ],
  practise:["What is your favourite colour?","What colour is the sky?","What colour is a banana?"]
},
{
  id:"numbers-1-10", level:"phonics", type:"flashcards", category:"First Words", icon:"🔢",
  title:"Numbers 1–10", kicker:"First Words · Starter",
  summary:"Count from one to ten with big number cards.",
  intro:"Let's count from one to ten!",
  cards:[
    {word:"One", emoji:"1", ko:"하나"}, {word:"Two", emoji:"2", ko:"둘"}, {word:"Three", emoji:"3", ko:"셋"},
    {word:"Four", emoji:"4", ko:"넷"}, {word:"Five", emoji:"5", ko:"다섯"}, {word:"Six", emoji:"6", ko:"여섯"},
    {word:"Seven", emoji:"7", ko:"일곱"}, {word:"Eight", emoji:"8", ko:"여덟"}, {word:"Nine", emoji:"9", ko:"아홉"},
    {word:"Ten", emoji:"10", ko:"열"}
  ],
  read:[
    {say:"I see one sun.", html:"I see <b>one</b> ☀️ sun.", ko:"나는 해 하나를 봐요."},
    {say:"I have two eyes.", html:"I have <b>two</b> 👀 eyes.", ko:"나는 눈이 두 개 있어요."},
    {say:"There are three cats.", html:"There are <b>three</b> 🐱🐱🐱 cats.", ko:"고양이가 세 마리 있어요."},
    {say:"Count: one, two, three, four, five!", html:"Count: <b>one, two, three, four, five!</b> ✋", ko:"세어 봐요: 하나, 둘, 셋, 넷, 다섯!"}
  ],
  practise:["Can you count from one to ten?","How old are you?","How many fingers do you have?"]
},
{
  id:"animals", level:"phonics", type:"flashcards", category:"First Words", icon:"🐾",
  title:"Animals", kicker:"First Words · Starter",
  summary:"Meet ten friendly animals and say their names.",
  intro:"Let's learn the names of animals!",
  cards:[
    {word:"Dog", emoji:"🐶", ko:"개"}, {word:"Cat", emoji:"🐱", ko:"고양이"}, {word:"Bird", emoji:"🐦", ko:"새"},
    {word:"Fish", emoji:"🐟", ko:"물고기"}, {word:"Horse", emoji:"🐴", ko:"말"}, {word:"Cow", emoji:"🐮", ko:"소"},
    {word:"Pig", emoji:"🐷", ko:"돼지"}, {word:"Duck", emoji:"🦆", ko:"오리"}, {word:"Rabbit", emoji:"🐰", ko:"토끼"},
    {word:"Lion", emoji:"🦁", ko:"사자"}
  ],
  read:[
    {say:"The cat and the dog see a mouse.", html:"The 🐱 <b>cat</b> and the 🐶 <b>dog</b> see a 🐭 <b>mouse</b>.", ko:"고양이와 개가 쥐를 봐요."},
    {say:"The horse and the cow eat.", html:"The 🐴 <b>horse</b> and the 🐮 <b>cow</b> eat.", ko:"말과 소가 먹어요."},
    {say:"I can see a pig and a duck.", html:"I can see a 🐷 <b>pig</b> and a 🦆 <b>duck</b>.", ko:"나는 돼지와 오리를 볼 수 있어요."},
    {say:"The lion is big. The rabbit is small.", html:"The 🦁 <b>lion</b> is big. The 🐰 <b>rabbit</b> is small.", ko:"사자는 커요. 토끼는 작아요."}
  ],
  practise:["What animals do you like?","What sound does a dog make?","Do you have a pet?"]
},
{
  id:"fruit", level:"phonics", type:"flashcards", category:"Food", icon:"🍓",
  title:"Fruit", kicker:"Food · Starter",
  summary:"Tasty fruit words: apple, banana, orange and more.",
  intro:"Let's learn the names of fruit!",
  cards:[
    {word:"Apple", emoji:"🍎", ko:"사과"}, {word:"Banana", emoji:"🍌", ko:"바나나"}, {word:"Orange", emoji:"🍊", ko:"오렌지"},
    {word:"Grapes", emoji:"🍇", ko:"포도"}, {word:"Strawberry", emoji:"🍓", ko:"딸기"}, {word:"Watermelon", emoji:"🍉", ko:"수박"},
    {word:"Pear", emoji:"🍐", ko:"배"}, {word:"Cherry", emoji:"🍒", ko:"체리"}, {word:"Lemon", emoji:"🍋", ko:"레몬"}
  ],
  read:[
    {say:"I eat an apple and a banana.", html:"I eat an 🍎 <b>apple</b> and a 🍌 <b>banana</b>.", ko:"나는 사과와 바나나를 먹어요."},
    {say:"The strawberry is red.", html:"The 🍓 <b>strawberry</b> is red.", ko:"딸기는 빨개요."},
    {say:"I like grapes and oranges.", html:"I like 🍇 <b>grapes</b> and 🍊 <b>oranges</b>.", ko:"나는 포도와 오렌지를 좋아해요."}
  ],
  practise:["What fruit do you like?","What colour is a banana?","Is an apple sweet?"]
},
{
  id:"classroom-objects", level:"phonics", type:"flashcards", category:"School", icon:"✏️",
  title:"Classroom Objects", kicker:"School · Starter",
  summary:"Things we use in class: pencil, book, bag and more.",
  intro:"Let's learn the things we use in the classroom!",
  cards:[
    {word:"Pencil", emoji:"✏️", ko:"연필"}, {word:"Pen", emoji:"🖊️", ko:"펜"}, {word:"Book", emoji:"📕", ko:"책"},
    {word:"Bag", emoji:"🎒", ko:"가방"}, {word:"Ruler", emoji:"📏", ko:"자"}, {word:"Scissors", emoji:"✂️", ko:"가위"},
    {word:"Chair", emoji:"🪑", ko:"의자"}, {word:"Crayon", emoji:"🖍️", ko:"크레용"}
  ],
  read:[
    {say:"This is my book and my pencil.", html:"This is my 📕 <b>book</b> and my ✏️ <b>pencil</b>.", ko:"이것은 내 책과 내 연필이에요."},
    {say:"The pen is on the chair.", html:"The 🖊️ <b>pen</b> is on the 🪑 <b>chair</b>.", ko:"펜이 의자 위에 있어요."},
    {say:"Open your bag.", html:"Open your 🎒 <b>bag</b>.", ko:"가방을 여세요."}
  ],
  practise:["What is in your bag?","Do you have a pencil?","Point to a book."]
},

/* ===================== ELEMENTARY (A2) ===================== */
{
  id:"a-day-at-the-market", level:"elementary", category:"Daily Life", icon:"🧺",
  title:"A Day at the Market", kicker:"Daily Life · Reading",
  summary:"A simple walk through a busy market — fruit, bread, and friendly faces.",
  paras:[
    "On Saturday morning, Maria goes to the <b>market</b>. The market is a busy place where people buy and sell food. Maria takes a big basket with her.",
    "First, she buys <b>fruit</b>. The apples are red and the bananas are yellow. They are very <b>fresh</b> because the farmer picked them today. Maria also buys some <b>bread</b>. It is warm and smells wonderful.",
    "Maria likes the market because it is <b>cheap</b>. The food does not cost a lot of money. She also likes to <b>chat</b> with the friendly sellers. When her basket is full, Maria walks home and makes lunch for her family."
  ],
  vocab:[
    {w:"market", p:"(n)", d:"a place where people buy and sell food and goods"},
    {w:"fruit", p:"(n)", d:"sweet food that grows on trees and plants"},
    {w:"fresh", p:"(adj)", d:"new and recently made or picked"},
    {w:"bread", p:"(n)", d:"a basic food made from flour and baked in an oven"},
    {w:"cheap", p:"(adj)", d:"not costing a lot of money"},
    {w:"chat", p:"(v)", d:"to talk in a friendly, relaxed way"}
  ],
  comprehension:[
    "Where does Maria go on Saturday morning?",
    "What colour are the apples and the bananas?",
    "Why is the fruit so fresh?",
    "Give one reason Maria likes the market.",
    "What does Maria do when her basket is full?"
  ],
  discussion:[
    "Do you like going to markets? Why or why not?",
    "What food do you buy every week?",
    "Is food cheaper at a market or a shop where you live?"
  ]
},
{
  id:"the-busy-honey-bees", level:"elementary", category:"Nature", icon:"🐝",
  title:"The Busy Honey Bees", kicker:"Nature · Reading",
  summary:"Tiny workers with a big job: how bees make honey and help our food grow.",
  paras:[
    "Bees are small <b>insects</b>, but they do very important work. They live together in a home called a <b>hive</b>. One hive can have thousands of bees.",
    "Every day, bees fly from <b>flower</b> to flower. They drink a sweet liquid called nectar. Back at the hive, they turn the nectar into <b>honey</b>. People love to eat honey because it is sweet and healthy.",
    "Bees also help <b>plants</b> grow. When a bee moves between flowers, it carries a yellow powder called pollen. This helps new fruit and vegetables grow. Without bees, we would have much less food. So bees are small, but they are very <b>useful</b>."
  ],
  vocab:[
    {w:"insect", p:"(n)", d:"a small animal with six legs, like a bee or an ant"},
    {w:"hive", p:"(n)", d:"the home where bees live together"},
    {w:"flower", p:"(n)", d:"the colourful part of a plant"},
    {w:"honey", p:"(n)", d:"the sweet food that bees make"},
    {w:"plant", p:"(n)", d:"a living thing that grows in the ground"},
    {w:"useful", p:"(adj)", d:"helpful; able to do an important job"}
  ],
  comprehension:[
    "What is the home of bees called?",
    "What sweet liquid do bees drink from flowers?",
    "What do bees make from nectar?",
    "How do bees help plants grow?",
    "Why does the writer say bees are useful?"
  ],
  discussion:[
    "Are there many bees where you live?",
    "Do you like honey? How do you eat it?",
    "What other small animals are useful to people?"
  ]
},
{
  id:"the-four-seasons", level:"elementary", category:"Nature", icon:"🍂",
  title:"The Four Seasons", kicker:"Nature · Reading",
  summary:"Spring, summer, autumn, winter — how the year changes around us.",
  paras:[
    "In many countries, the year has four <b>seasons</b>. Each season has different <b>weather</b>. The seasons are spring, summer, autumn, and winter.",
    "In <b>spring</b>, the weather is warm and flowers begin to grow. In summer, the days are long and the sun is <b>hot</b>. Many people go to the beach.",
    "In autumn, the leaves on the trees turn brown and <b>fall</b> to the ground. In winter, the weather is <b>cold</b>. In some places, white snow covers the streets. After winter, spring comes again, and the year begins once more."
  ],
  vocab:[
    {w:"season", p:"(n)", d:"one of the four parts of the year"},
    {w:"weather", p:"(n)", d:"the condition outside: sun, rain, wind, or snow"},
    {w:"spring", p:"(n)", d:"the season when flowers begin to grow"},
    {w:"hot", p:"(adj)", d:"having a high temperature"},
    {w:"fall", p:"(v)", d:"to move down towards the ground"},
    {w:"cold", p:"(adj)", d:"having a low temperature"}
  ],
  comprehension:[
    "How many seasons are in the year?",
    "What happens to flowers in spring?",
    "Why do people go to the beach in summer?",
    "What happens to the leaves in autumn?",
    "What covers the streets in winter in some places?"
  ],
  discussion:[
    "How many seasons does your country have?",
    "Which season do you like the most? Why?",
    "What clothes do you wear in winter?"
  ]
},
{
  id:"a-robot-in-the-garden", level:"elementary", category:"Technology", icon:"🤖",
  title:"A Robot in the Garden", kicker:"Technology · Reading",
  summary:"Meet a small helpful robot that takes care of a family's plants.",
  paras:[
    "Tom has a small <b>robot</b> in his garden. The robot is white and round. It has a clever <b>battery</b> inside, so it can move by itself.",
    "Every morning, the robot looks at the <b>soil</b>. If the ground is dry, the robot gives the plants some <b>water</b>. It never forgets, and it is never tired.",
    "Tom thinks the robot is very <b>helpful</b>. The garden is now green and full of vegetables. But Tom still does one job himself: he <b>picks</b> the tomatoes, because that is his favourite part."
  ],
  vocab:[
    {w:"robot", p:"(n)", d:"a machine that can do jobs by itself"},
    {w:"battery", p:"(n)", d:"a part that stores power for a machine"},
    {w:"soil", p:"(n)", d:"the earth where plants grow"},
    {w:"water", p:"(v)", d:"to give water to plants"},
    {w:"helpful", p:"(adj)", d:"useful; doing good work for someone"},
    {w:"pick", p:"(v)", d:"to take fruit or flowers from a plant"}
  ],
  comprehension:[
    "What colour is Tom's robot?",
    "What is inside the robot, so it can move?",
    "What does the robot do if the soil is dry?",
    "Why does Tom think the robot is helpful?",
    "Which job does Tom still do himself?"
  ],
  discussion:[
    "Would you like a robot to help you at home? With what job?",
    "Do you grow any plants or vegetables?",
    "What machines help you every day?"
  ]
},

/* ===================== INTERMEDIATE (B1) ===================== */
{
  id:"how-octopuses-solve-problems", level:"intermediate", category:"Science", icon:"🐙",
  title:"How Octopuses Solve Problems", kicker:"Science · Reading",
  summary:"These eight-armed ocean animals are far smarter than they look.",
  paras:[
    "The octopus is one of the most <b>intelligent</b> animals in the ocean. It has eight arms, three hearts, and a brain that works in surprising ways. Scientists who study octopuses are often <b>amazed</b> by what they can do.",
    "In one famous <b>experiment</b>, an octopus learned to open a glass jar to reach the food inside. It used its arms to twist the lid, just like a person would. Even more <b>impressive</b>, the octopus remembered how to do it the next time.",
    "Octopuses can also change the colour of their skin to <b>hide</b> from danger. In a single second, an octopus can match the colour and pattern of a rock or a plant. This clever trick is called camouflage, and it helps the octopus <b>escape</b> from hungry enemies.",
    "Because they are so smart, octopuses sometimes <b>behave</b> in playful ways. Some have learned to squirt water at lights to turn them off, while others enjoy taking objects apart. Many scientists believe there is still a great deal we do not <b>understand</b> about these mysterious creatures."
  ],
  vocab:[
    {w:"intelligent", p:"(adj)", d:"able to learn and understand things well"},
    {w:"amazed", p:"(adj)", d:"very surprised in a positive way"},
    {w:"experiment", p:"(n)", d:"a scientific test to learn something new"},
    {w:"impressive", p:"(adj)", d:"causing admiration; very good"},
    {w:"hide", p:"(v)", d:"to make yourself difficult to see or find"},
    {w:"escape", p:"(v)", d:"to get away from danger"},
    {w:"behave", p:"(v)", d:"to act in a particular way"},
    {w:"understand", p:"(v)", d:"to know the meaning or reason for something"}
  ],
  comprehension:[
    "How many hearts does an octopus have?",
    "What did the octopus learn to do in the famous experiment?",
    "Why was it impressive that the octopus opened the jar a second time?",
    "How does changing colour help an octopus survive?",
    "Give one example of playful octopus behaviour from the text."
  ],
  discussion:[
    "What is the most intelligent animal you know about?",
    "Why do you think some animals are smarter than others?",
    "Should we keep very intelligent animals in zoos or aquariums? Why or why not?"
  ]
},
{
  id:"the-sweet-story-of-chocolate", level:"intermediate", category:"Food & History", icon:"🍫",
  title:"The Sweet Story of Chocolate", kicker:"Food & History · Reading",
  summary:"From a bitter ancient drink to the sweet treat we love today.",
  paras:[
    "Chocolate is one of the most popular treats in the world, but its story is much older than most people <b>realise</b>. It begins thousands of years ago with the cacao tree, which grows in warm, rainy <b>regions</b> of Central and South America.",
    "Long ago, the Maya and Aztec people made a drink from cacao beans. This early chocolate was thick and <b>bitter</b>, not sweet at all. It was so valuable that people sometimes used cacao beans as <b>money</b>.",
    "When the drink arrived in Europe, cooks began to add sugar to <b>improve</b> the taste. For a long time, chocolate stayed a drink. It was only in the 1800s that factories learned to make solid chocolate bars, which quickly became a <b>favourite</b> around the world.",
    "Today, chocolate is a huge <b>industry</b>. Farmers in many countries grow cacao, and companies turn it into thousands of products. Yet the journey from a bitter bean to a sweet bar reminds us that even ordinary foods can have a rich and surprising <b>history</b>."
  ],
  vocab:[
    {w:"realise", p:"(v)", d:"to understand or become aware of something"},
    {w:"region", p:"(n)", d:"a particular area or part of the world"},
    {w:"bitter", p:"(adj)", d:"having a sharp, not sweet taste"},
    {w:"money", p:"(n)", d:"coins and notes used to buy things"},
    {w:"improve", p:"(v)", d:"to make something better"},
    {w:"favourite", p:"(n)", d:"the thing you like the most"},
    {w:"industry", p:"(n)", d:"the work of making and selling a product"},
    {w:"history", p:"(n)", d:"the story of events in the past"}
  ],
  comprehension:[
    "Where does the cacao tree grow?",
    "How did early chocolate taste?",
    "What did the Maya and Aztec people sometimes use cacao beans for?",
    "What did European cooks add to chocolate to change the taste?",
    "When did factories begin making solid chocolate bars?"
  ],
  discussion:[
    "Do you like chocolate? What is your favourite kind?",
    "What is a popular food from your country, and where does it come from?",
    "Why do you think some foods become popular all over the world?"
  ]
},
{
  id:"music-and-the-brain", level:"intermediate", category:"Science", icon:"🎵",
  title:"Music and the Brain", kicker:"Science · Reading",
  summary:"Why a good song can lift your mood, calm your nerves, and help you learn.",
  paras:[
    "Almost everyone enjoys music, but few people stop to think about what it does to the <b>brain</b>. Scientists have discovered that listening to music affects many different parts of the brain at the same time.",
    "When we hear a song we love, the brain releases a chemical that makes us feel <b>pleasure</b>. This is the same chemical that is connected to good food and laughter. That is why a favourite song can quickly <b>improve</b> our mood.",
    "Music can also help us <b>concentrate</b>. Many students play quiet music while they study because it helps them <b>focus</b> and block out noise. Doctors have even used music to help patients feel calm before an operation.",
    "Perhaps most surprising of all, music can help with <b>memory</b>. People who cannot remember names or dates can often still sing songs from their childhood. For this reason, music is now used to <b>support</b> people who have lost some of their memory, bringing comfort and joy."
  ],
  vocab:[
    {w:"brain", p:"(n)", d:"the organ in your head that controls thought"},
    {w:"pleasure", p:"(n)", d:"a feeling of happiness or enjoyment"},
    {w:"improve", p:"(v)", d:"to make something better"},
    {w:"concentrate", p:"(v)", d:"to give all your attention to one thing"},
    {w:"focus", p:"(v)", d:"to direct your attention carefully"},
    {w:"memory", p:"(n)", d:"the ability to remember things"},
    {w:"support", p:"(v)", d:"to help someone"},
    {w:"calm", p:"(adj)", d:"relaxed and not worried"}
  ],
  comprehension:[
    "How many parts of the brain does music affect?",
    "What does the brain release when we hear a song we love?",
    "Why do many students play quiet music while studying?",
    "How have doctors used music with patients?",
    "What can some people still do even after they lose part of their memory?"
  ],
  discussion:[
    "What kind of music do you listen to, and when?",
    "Does music help you study or relax? Explain.",
    "Is there a song that brings back a strong memory for you?"
  ]
},
{
  id:"the-city-that-grew-a-garden", level:"intermediate", category:"Community", icon:"🌱",
  title:"The City That Grew a Garden", kicker:"Community · Reading",
  summary:"How neighbours turned an empty lot into a green space for everyone.",
  paras:[
    "In the middle of a busy city, there was once an empty piece of land. It was grey, ugly, and full of <b>rubbish</b>. For years, nobody knew what to do with it, and most people simply walked past.",
    "Then a group of <b>neighbours</b> had an idea. They decided to clean the land and turn it into a community <b>garden</b>. On the first weekend, dozens of people came with bags, gloves, and tools to help. Together, they removed the rubbish and prepared the <b>ground</b>.",
    "Soon, the empty land was full of life. People planted vegetables, flowers, and small trees. Children learned how to <b>grow</b> their own food, and older neighbours shared advice they had known for years. The garden became a place to meet, relax, and feel <b>proud</b>.",
    "The project did more than create a green space. It brought the community closer together. People who had never spoken before became friends. The story shows that with a little effort, ordinary people can <b>transform</b> their own neighbourhood and <b>benefit</b> everyone who lives there."
  ],
  vocab:[
    {w:"rubbish", p:"(n)", d:"things that are thrown away; waste"},
    {w:"neighbour", p:"(n)", d:"a person who lives near you"},
    {w:"garden", p:"(n)", d:"a piece of land where plants are grown"},
    {w:"ground", p:"(n)", d:"the surface of the earth"},
    {w:"grow", p:"(v)", d:"to help plants develop and get bigger"},
    {w:"proud", p:"(adj)", d:"feeling pleased about something you did"},
    {w:"transform", p:"(v)", d:"to change something completely"},
    {w:"benefit", p:"(v)", d:"to be helpful or useful to someone"}
  ],
  comprehension:[
    "What did the empty land look like at the start?",
    "What idea did the neighbours have?",
    "What did people do on the first weekend?",
    "What did children learn to do in the garden?",
    "Besides a green space, what did the project create?"
  ],
  discussion:[
    "Is there a place near you that could be improved? How?",
    "Have you ever worked together with neighbours on a project?",
    "Why is it good for a community to have green spaces?"
  ]
},

/* ===================== UPPER-INTERMEDIATE (B2) ===================== */
{
  id:"the-secret-language-of-trees", level:"upper", category:"Nature", icon:"🌳",
  title:"The Secret Language of Trees", kicker:"Nature · Reading",
  summary:"Beneath the forest floor, trees share food and warnings through a hidden network.",
  paras:[
    "For centuries, we imagined a forest as a simple collection of individual trees, each one <b>competing</b> with its neighbours for light and water. Recent research, however, suggests a far more surprising picture: trees are deeply <b>connected</b>, and they appear to communicate.",
    "The secret lies beneath the soil. The roots of trees are linked by a vast network of tiny fungi, which scientists sometimes call the \"wood wide web.\" Through this network, trees can <b>exchange</b> sugar, water, and chemical signals across great distances.",
    "Perhaps most remarkable is the way trees seem to help one another. A large, healthy tree may send nutrients to a smaller, <b>struggling</b> one nearby. When insects attack, a tree can release chemicals that <b>warn</b> its neighbours, giving them time to prepare their own <b>defences</b>.",
    "These discoveries are changing the way scientists think about forests. Rather than a battlefield of lonely competitors, a forest may be a <b>cooperative</b> community in which survival depends on connection. The findings also carry a practical lesson: when we cut down forests, we may be breaking apart relationships that took centuries to <b>establish</b>."
  ],
  vocab:[
    {w:"compete", p:"(v)", d:"to try to win or do better than others"},
    {w:"connected", p:"(adj)", d:"joined or linked together"},
    {w:"exchange", p:"(v)", d:"to give something and receive something in return"},
    {w:"struggling", p:"(adj)", d:"having difficulty; finding something hard"},
    {w:"warn", p:"(v)", d:"to tell someone about a possible danger"},
    {w:"defence", p:"(n)", d:"protection against attack"},
    {w:"cooperative", p:"(adj)", d:"working together for a shared goal"},
    {w:"establish", p:"(v)", d:"to build or create something that lasts"}
  ],
  comprehension:[
    "How did people traditionally imagine a forest?",
    "What links the roots of trees beneath the soil?",
    "What can trees exchange through this network?",
    "How does a tree warn its neighbours about insects?",
    "What practical lesson do these discoveries suggest about cutting down forests?"
  ],
  discussion:[
    "Did this article change how you think about forests? How?",
    "Should this research affect how we use and protect forests?",
    "In what other parts of nature do living things cooperate?"
  ]
},
{
  id:"why-do-we-dream", level:"upper", category:"Science", icon:"💤",
  title:"Why Do We Dream?", kicker:"Science · Reading",
  summary:"Every night our minds create strange stories. Scientists still debate why.",
  paras:[
    "Every night, as we sleep, our minds create vivid stories full of strange images and powerful emotions. Dreams have <b>fascinated</b> human beings for thousands of years, yet even today scientists cannot fully <b>explain</b> why we have them.",
    "One popular theory suggests that dreams help us process our <b>emotions</b>. According to this view, the sleeping brain replays difficult experiences in a safe space, helping us cope with stress and <b>recover</b> from painful events. People who sleep well after a hard day often wake up feeling calmer.",
    "Another theory connects dreaming to <b>memory</b>. During sleep, the brain sorts through the day's events, deciding what to keep and what to forget. Dreams may be a side effect of this process, as the brain <b>strengthens</b> important memories and connects new information to old.",
    "Some researchers take a more practical view, arguing that dreams allow us to <b>rehearse</b> dangerous situations without real risk. By facing imaginary threats at night, we may become better prepared for the <b>challenges</b> of waking life. Whichever theory is correct, dreaming clearly plays an important role, and it remains one of the great <b>mysteries</b> of the human mind."
  ],
  vocab:[
    {w:"fascinate", p:"(v)", d:"to attract and hold someone's interest"},
    {w:"explain", p:"(v)", d:"to make something clear or easy to understand"},
    {w:"emotion", p:"(n)", d:"a strong feeling such as joy or fear"},
    {w:"recover", p:"(v)", d:"to return to a normal or healthy state"},
    {w:"memory", p:"(n)", d:"information stored in the mind"},
    {w:"strengthen", p:"(v)", d:"to make something stronger"},
    {w:"rehearse", p:"(v)", d:"to practise something before doing it for real"},
    {w:"challenge", p:"(n)", d:"a difficult task that tests your ability"}
  ],
  comprehension:[
    "How long have dreams fascinated human beings?",
    "According to the first theory, how do dreams help us?",
    "What does the brain do with the day's events during sleep?",
    "How might dreams help us prepare for waking life?",
    "What does the writer call dreaming at the end of the text?"
  ],
  discussion:[
    "Do you often remember your dreams? Describe one if you can.",
    "Which theory about dreams do you find most convincing? Why?",
    "Do you think dreams have meaning, or are they just random?"
  ]
},
{
  id:"the-return-of-the-wolves", level:"upper", category:"Conservation", icon:"🐺",
  title:"The Return of the Wolves", kicker:"Conservation · Reading",
  summary:"When wolves came back to one national park, the whole landscape changed.",
  paras:[
    "In 1995, scientists made a bold decision: they would bring wolves back to a national park where the animals had been absent for seventy years. Many people were <b>nervous</b>, fearing that the wolves would cause harm. What followed surprised almost everyone.",
    "Before the wolves returned, large numbers of deer had been eating the young trees along the rivers. With no <b>predator</b> to fear, the deer grazed freely, and the <b>landscape</b> grew bare. The return of the wolves changed this <b>balance</b> almost immediately.",
    "As the wolves hunted, the deer became more careful and avoided certain areas. Trees and bushes began to <b>recover</b>, and soon birds, beavers, and other animals returned to the greener riverbanks. The beavers built dams, which created pools that <b>attracted</b> even more wildlife.",
    "Most astonishing of all, the rivers themselves changed. The new plants held the soil in place, so the riverbanks stopped collapsing and the water ran clearer. Scientists call this kind of chain reaction a \"trophic cascade.\" The story of the wolves shows how a single <b>species</b> can <b>influence</b> an entire ecosystem in ways no one expected."
  ],
  vocab:[
    {w:"nervous", p:"(adj)", d:"worried or slightly frightened"},
    {w:"predator", p:"(n)", d:"an animal that hunts others for food"},
    {w:"landscape", p:"(n)", d:"the visible features of an area of land"},
    {w:"balance", p:"(n)", d:"a stable state where things are in proportion"},
    {w:"recover", p:"(v)", d:"to return to a healthy condition"},
    {w:"attract", p:"(v)", d:"to make someone or something come closer"},
    {w:"species", p:"(n)", d:"a group of similar living things"},
    {w:"influence", p:"(v)", d:"to have an effect on something"}
  ],
  comprehension:[
    "What decision did scientists make in 1995?",
    "Why were many people nervous about the plan?",
    "What had the deer been doing before the wolves returned?",
    "How did the behaviour of the deer change once wolves were present?",
    "What surprising effect did the changes have on the rivers?"
  ],
  discussion:[
    "Were you surprised by what the wolves changed? Why?",
    "Should humans try to control nature in this way? What are the risks?",
    "Can you think of another animal that is important to its environment?"
  ]
},
{
  id:"how-libraries-are-changing", level:"upper", category:"Society", icon:"📚",
  title:"How Libraries Are Changing", kicker:"Society · Reading",
  summary:"In the digital age, libraries are quietly reinventing what they offer.",
  paras:[
    "When most people picture a library, they imagine quiet rooms filled with shelves of books. While that image is not wrong, it is increasingly <b>incomplete</b>. Around the world, libraries are quietly <b>reinventing</b> themselves for the digital age.",
    "Many libraries now lend far more than books. Visitors can borrow tools, musical instruments, telescopes, and even kitchen equipment. Some offer free access to computers and the internet, which is <b>essential</b> for people who cannot afford these things at home. In this way, libraries help reduce <b>inequality</b>.",
    "Libraries have also become community <b>hubs</b>. They host language classes, job-search workshops, and clubs for children and older people. For newcomers to a city, a library can be one of the first <b>welcoming</b> places they discover, offering both information and human connection.",
    "Some people argue that the internet has made libraries <b>unnecessary</b>, but the opposite may be true. As more of life moves online, the need for free, trusted, public spaces grows. By continuing to <b>adapt</b>, libraries prove that they are not relics of the past but valuable institutions with a clear role in the future."
  ],
  vocab:[
    {w:"incomplete", p:"(adj)", d:"not having all the parts; not whole"},
    {w:"reinvent", p:"(v)", d:"to change something so it is completely new"},
    {w:"essential", p:"(adj)", d:"absolutely necessary"},
    {w:"inequality", p:"(n)", d:"an unfair difference between groups of people"},
    {w:"hub", p:"(n)", d:"a central place of activity"},
    {w:"welcoming", p:"(adj)", d:"friendly and making people feel comfortable"},
    {w:"unnecessary", p:"(adj)", d:"not needed"},
    {w:"adapt", p:"(v)", d:"to change in order to deal with new conditions"}
  ],
  comprehension:[
    "What is the common image of a library?",
    "Name two unusual things that some libraries now lend.",
    "How do libraries help reduce inequality?",
    "What kinds of community activities do libraries host?",
    "Why does the writer believe libraries are still needed in the digital age?"
  ],
  discussion:[
    "When did you last visit a library? What did you do there?",
    "Do you agree that the internet has not made libraries unnecessary? Why?",
    "What services would you most like your local library to offer?"
  ]
},

/* ===================== ADVANCED (C1) ===================== */
{
  id:"the-mathematics-of-snowflakes", level:"advanced", category:"Science", icon:"❄️",
  title:"The Mathematics of Snowflakes", kicker:"Science · Reading",
  summary:"Why every snowflake is unique, yet all share the same six-sided symmetry.",
  paras:[
    "It is often said that no two snowflakes are alike, a claim that sounds almost romantic. Yet behind this poetic idea lies a precise and <b>elegant</b> piece of science, governed by the behaviour of water molecules as they freeze.",
    "A snowflake begins when water vapour in a cloud freezes around a tiny particle of dust. As the molecules lock together, they arrange themselves in a hexagonal, or six-sided, pattern. This underlying <b>structure</b> is the reason that virtually every snowflake displays a striking six-fold <b>symmetry</b>.",
    "Why, then, are snowflakes so endlessly varied? The answer lies in the journey each crystal takes as it falls. Temperature and humidity shift constantly, and these conditions <b>determine</b> exactly how the arms of the snowflake grow. Because no two crystals follow precisely the same path through the atmosphere, each one develops a <b>distinct</b> and intricate shape.",
    "What makes the phenomenon so <b>compelling</b> is the tension between order and chance. The six-sided symmetry reflects rigid physical laws, while the infinite variety reflects the <b>randomness</b> of the environment. In this sense, a snowflake is a perfect <b>illustration</b> of how simple rules, combined with chaotic conditions, can <b>generate</b> astonishing complexity — a principle that appears throughout the natural world."
  ],
  vocab:[
    {w:"elegant", p:"(adj)", d:"pleasingly simple and clever"},
    {w:"structure", p:"(n)", d:"the way the parts of something are arranged"},
    {w:"symmetry", p:"(n)", d:"balanced, matching form on opposite sides"},
    {w:"determine", p:"(v)", d:"to decide or control the outcome of something"},
    {w:"distinct", p:"(adj)", d:"clearly different or separate"},
    {w:"compelling", p:"(adj)", d:"powerfully interesting; hard to ignore"},
    {w:"randomness", p:"(n)", d:"the quality of happening by chance"},
    {w:"generate", p:"(v)", d:"to produce or create something"}
  ],
  comprehension:[
    "What common saying about snowflakes does the writer begin with?",
    "How does a snowflake first begin to form?",
    "Why do almost all snowflakes have six-fold symmetry?",
    "What causes each snowflake to develop a distinct shape?",
    "What broader principle does the snowflake illustrate, according to the final paragraph?"
  ],
  discussion:[
    "Do you find scientific explanations of nature beautiful, or do they remove the magic? Explain.",
    "Can you think of another example where simple rules create great complexity?",
    "Why do you think humans are so drawn to patterns and symmetry?"
  ]
},
{
  id:"the-woman-who-mapped-the-ocean-floor", level:"advanced", category:"Biography", icon:"🌊",
  title:"The Woman Who Mapped the Ocean Floor", kicker:"Biography · Reading",
  summary:"Marie Tharp's maps revealed the hidden mountains beneath the sea — and changed science.",
  paras:[
    "In the middle of the twentieth century, the floor of the ocean was almost entirely <b>unknown</b>, a vast darkness that few scientists believed they could ever map. The person who changed this was a quiet, <b>determined</b> geologist named Marie Tharp.",
    "Because women were not allowed aboard the research ships of the time, Tharp could not collect data at sea herself. Instead, she worked on land, transforming thousands of <b>measurements</b> into detailed maps. Slowly, an extraordinary <b>feature</b> emerged from her drawings: a great mountain range running down the centre of the Atlantic, split by a deep valley.",
    "Tharp realised that this valley was evidence of continents slowly drifting apart. At first, her colleague dismissed the idea as \"girl talk,\" reflecting the <b>prejudice</b> she faced throughout her career. Yet the data were undeniable, and her maps gradually <b>convinced</b> the scientific community.",
    "Her work became central to the theory of plate tectonics, one of the most important ideas in modern geology. For decades, however, Tharp received little <b>recognition</b>, her contribution overshadowed by male colleagues. Only late in her life did the scientific world fully <b>acknowledge</b> her achievement, celebrating a woman whose patient, careful work had quite literally redrawn our understanding of the planet and secured her <b>legacy</b>."
  ],
  vocab:[
    {w:"unknown", p:"(adj)", d:"not known or explored"},
    {w:"determined", p:"(adj)", d:"having firm resolve; not giving up"},
    {w:"measurement", p:"(n)", d:"a number found by measuring something"},
    {w:"feature", p:"(n)", d:"a noticeable part or quality of something"},
    {w:"prejudice", p:"(n)", d:"an unfair opinion not based on reason"},
    {w:"convince", p:"(v)", d:"to make someone believe something is true"},
    {w:"recognition", p:"(n)", d:"public acknowledgement of someone's work"},
    {w:"acknowledge", p:"(v)", d:"to accept or admit that something is true"}
  ],
  comprehension:[
    "What was the state of knowledge about the ocean floor in the mid-twentieth century?",
    "Why could Marie Tharp not collect data at sea herself?",
    "What surprising feature emerged from her maps?",
    "How did her colleague first react to her interpretation?",
    "Why did Tharp receive little recognition for many years?"
  ],
  discussion:[
    "Why do you think some scientists are forgotten while others are famous?",
    "How have opportunities for women in science changed since Tharp's time?",
    "Is patient, careful work valued enough today? Explain your view."
  ]
},
{
  id:"the-quiet-power-of-slow-travel", level:"advanced", category:"Culture", icon:"🚂",
  title:"The Quiet Power of Slow Travel", kicker:"Culture · Reading",
  summary:"In a world obsessed with seeing everything quickly, some travellers choose to slow down.",
  paras:[
    "Modern tourism often resembles a race. Travellers dash between famous landmarks, photograph them quickly, and move on, eager to <b>accumulate</b> as many destinations as possible. In reaction to this hurried approach, a quieter philosophy known as \"slow travel\" has begun to <b>flourish</b>.",
    "Slow travel encourages visitors to spend longer in fewer places. Rather than ticking sights off a list, the slow traveller seeks to <b>immerse</b> themselves in daily life: shopping at local markets, learning a few phrases of the language, and forming genuine connections with the people they meet. The goal is depth rather than <b>quantity</b>.",
    "Advocates argue that this approach is not only more <b>rewarding</b> but also more responsible. By staying longer and spending money in small, local businesses, slow travellers can <b>contribute</b> meaningfully to the communities they visit. Travelling by train rather than plane, and walking rather than driving, also reduces the environmental <b>impact</b> of each journey.",
    "Critics point out that slow travel is a luxury, requiring time and money that many people simply do not have. This <b>objection</b> has merit, yet the underlying idea may still hold value for everyone. Even a short trip can be approached with curiosity and patience. In an age that prizes speed above all else, slow travel offers a gentle reminder that the richest experiences often <b>resist</b> being rushed."
  ],
  vocab:[
    {w:"accumulate", p:"(v)", d:"to collect a growing number of things"},
    {w:"flourish", p:"(v)", d:"to grow and develop successfully"},
    {w:"immerse", p:"(v)", d:"to involve yourself deeply in something"},
    {w:"quantity", p:"(n)", d:"an amount or number of something"},
    {w:"rewarding", p:"(adj)", d:"giving satisfaction or a sense of value"},
    {w:"contribute", p:"(v)", d:"to give something to help a result"},
    {w:"impact", p:"(n)", d:"the effect something has"},
    {w:"objection", p:"(n)", d:"a reason for disagreeing with something"}
  ],
  comprehension:[
    "What does modern tourism often resemble, according to the writer?",
    "What does the slow traveller seek instead of ticking sights off a list?",
    "Give two ways slow travel can be more responsible.",
    "What criticism of slow travel does the writer acknowledge?",
    "How does the writer respond to that criticism in the final paragraph?"
  ],
  discussion:[
    "When you travel, do you prefer to see many places or to explore a few deeply? Why?",
    "Do you agree that slow travel is mainly a luxury? Explain.",
    "How might travelling more slowly change what you remember about a place?"
  ]
},
{
  id:"living-alongside-artificial-intelligence", level:"advanced", category:"Technology", icon:"🧠",
  title:"Living Alongside Artificial Intelligence", kicker:"Technology · Reading",
  summary:"As AI enters daily life, society faces a balance between opportunity and caution.",
  paras:[
    "Artificial intelligence has moved swiftly from the pages of science fiction into the fabric of everyday life. It now recommends our films, filters our messages, and assists doctors in reading medical scans. As these systems grow more <b>capable</b>, society faces an important question: how should we live alongside them?",
    "The potential benefits are considerable. AI can analyse enormous quantities of information far faster than any human, helping researchers detect diseases earlier and address problems that once seemed <b>insurmountable</b>. Used wisely, such tools could <b>enhance</b> human ability rather than replace it, freeing people to focus on creative and caring work.",
    "Yet thoughtful observers urge <b>caution</b>. Because AI systems learn from existing data, they can absorb and even amplify human <b>bias</b>, producing unfair outcomes that are difficult to detect. There are also serious concerns about privacy, employment, and the danger of relying on decisions that few people fully <b>comprehend</b>.",
    "The wisest path is unlikely to be either blind enthusiasm or outright rejection. Instead, it calls for careful <b>regulation</b>, honest public debate, and a clear sense of which decisions should remain firmly in human hands. The history of technology suggests that tools themselves are rarely good or bad; what matters is the <b>wisdom</b> with which we choose to <b>deploy</b> them."
  ],
  vocab:[
    {w:"capable", p:"(adj)", d:"able to do things effectively"},
    {w:"insurmountable", p:"(adj)", d:"too great to be overcome"},
    {w:"enhance", p:"(v)", d:"to improve the quality or value of something"},
    {w:"caution", p:"(n)", d:"care taken to avoid danger or mistakes"},
    {w:"bias", p:"(n)", d:"an unfair preference or prejudice"},
    {w:"comprehend", p:"(v)", d:"to understand something fully"},
    {w:"regulation", p:"(n)", d:"an official rule that controls something"},
    {w:"deploy", p:"(v)", d:"to put something into use"}
  ],
  comprehension:[
    "Give two everyday examples of AI mentioned in the text.",
    "How can AI help researchers, according to the second paragraph?",
    "Why can AI systems produce unfair outcomes?",
    "Name two concerns the writer raises about AI besides bias.",
    "What does the writer suggest is the wisest path forward?"
  ],
  discussion:[
    "Where do you already notice AI in your own daily life?",
    "Do the benefits of AI outweigh the risks, in your opinion? Why?",
    "Which decisions do you believe should always remain in human hands?"
  ]
},

/* ===================== BEGINNER (A1) ===================== */
{
  id:"my-family", level:"beginner", category:"Daily Life", icon:"👨‍👩‍👧",
  title:"My Family", kicker:"Daily Life · Reading",
  summary:"A short, simple text about the people in a family.",
  paras:[
    "This is my <b>family</b>. We are five people. I love my family very much.",
    "My <b>mother</b> is a nurse. My <b>father</b> is a teacher. They work hard every day.",
    "I have one <b>sister</b> and one <b>brother</b>. We <b>play</b> together after school. On Sunday, we are all <b>happy</b> at home."
  ],
  vocab:[
    {w:"family", p:"(n)", d:"the people you live with, like your parents"},
    {w:"mother", p:"(n)", d:"your female parent"},
    {w:"father", p:"(n)", d:"your male parent"},
    {w:"sister", p:"(n)", d:"a girl with the same parents as you"},
    {w:"brother", p:"(n)", d:"a boy with the same parents as you"},
    {w:"happy", p:"(adj)", d:"feeling good and glad"}
  ],
  comprehension:[
    "How many people are in the family?",
    "What is the mother's job?",
    "What is the father's job?",
    "When is the family all happy at home?"
  ],
  discussion:[
    "How many people are in your family?",
    "What jobs do people in your family do?",
    "What do you do together as a family?"
  ]
},
{
  id:"my-busy-day", level:"beginner", category:"Daily Life", icon:"⏰",
  title:"My Busy Day", kicker:"Daily Life · Reading",
  summary:"Simple daily routine: morning, school, and evening.",
  paras:[
    "I get up at seven o'clock. First, I eat <b>breakfast</b> and drink some milk.",
    "Then I go to <b>school</b>. I <b>learn</b> English, maths, and art. I like to <b>read</b> books.",
    "After school, I do my <b>homework</b>. In the evening, I have dinner and go to <b>sleep</b>. I am tired but happy."
  ],
  vocab:[
    {w:"breakfast", p:"(n)", d:"the first meal of the day"},
    {w:"school", p:"(n)", d:"the place where children learn"},
    {w:"learn", p:"(v)", d:"to get new knowledge or skills"},
    {w:"read", p:"(v)", d:"to look at words and understand them"},
    {w:"homework", p:"(n)", d:"school work you do at home"},
    {w:"sleep", p:"(v)", d:"to rest with your eyes closed at night"}
  ],
  comprehension:[
    "What time does the writer get up?",
    "What does the writer eat and drink first?",
    "Name two things the writer learns at school.",
    "What does the writer do after school?"
  ],
  discussion:[
    "What time do you get up?",
    "What do you eat for breakfast?",
    "What do you do after school or work?"
  ]
},
{
  id:"at-the-park", level:"beginner", category:"Nature", icon:"🌳",
  title:"At the Park", kicker:"Nature · Reading",
  summary:"A simple story about a fun day outside at the park.",
  paras:[
    "On Saturday, we go to the <b>park</b>. The sun is warm and the sky is blue.",
    "I can see green <b>trees</b> and many <b>birds</b>. My little dog likes to <b>run</b> on the grass.",
    "We eat sandwiches and <b>play</b> with a ball. The park is a happy place. We go home when the sun goes down."
  ],
  vocab:[
    {w:"park", p:"(n)", d:"a green place outside where people relax"},
    {w:"tree", p:"(n)", d:"a big plant with a trunk and leaves"},
    {w:"bird", p:"(n)", d:"a small animal that can fly"},
    {w:"run", p:"(v)", d:"to move fast on your feet"},
    {w:"play", p:"(v)", d:"to do something fun"},
    {w:"grass", p:"(n)", d:"the green plants that cover the ground"}
  ],
  comprehension:[
    "What day do they go to the park?",
    "What is the weather like?",
    "What does the dog like to do?",
    "When do they go home?"
  ],
  discussion:[
    "Is there a park near your home?",
    "What do you like to do outside?",
    "What animals can you see in a park?"
  ]
},

/* ===================== PRE-INTERMEDIATE (A2–B1) ===================== */
{
  id:"the-neighbourhood-bakery", level:"pre-int", category:"Community", icon:"🥖",
  title:"The Neighbourhood Bakery", kicker:"Community · Reading",
  summary:"How one small bakery became the heart of a busy street.",
  paras:[
    "Every morning before sunrise, Elena opens her small <b>bakery</b> on the corner of a busy street. By the time the sun comes up, the smell of fresh bread fills the whole <b>neighbourhood</b>.",
    "Elena learned to bake from her grandmother when she was a child. She still uses the same old <b>recipes</b>, and she believes that good bread needs time, warm hands, and <b>patience</b>.",
    "The bakery is more than a shop. Neighbours meet there to talk, children stop for a sweet <b>treat</b> after school, and older people come simply to enjoy the friendly <b>atmosphere</b>.",
    "Big supermarkets have opened nearby, but Elena is not <b>worried</b>. \"People do not only want bread,\" she says with a smile. \"They want a place where somebody knows their name.\" Her little bakery <b>survives</b> because it offers something a supermarket cannot."
  ],
  vocab:[
    {w:"bakery", p:"(n)", d:"a shop that makes and sells bread and cakes"},
    {w:"neighbourhood", p:"(n)", d:"the area around where you live"},
    {w:"recipe", p:"(n)", d:"instructions for making a food dish"},
    {w:"patience", p:"(n)", d:"the ability to wait calmly"},
    {w:"treat", p:"(n)", d:"a special, enjoyable thing, often to eat"},
    {w:"atmosphere", p:"(n)", d:"the feeling or mood of a place"},
    {w:"worried", p:"(adj)", d:"feeling anxious about a problem"},
    {w:"survive", p:"(v)", d:"to continue to exist despite difficulty"}
  ],
  comprehension:[
    "What time does Elena open her bakery?",
    "Who taught Elena to bake?",
    "What does Elena believe good bread needs?",
    "Why do neighbours enjoy coming to the bakery?",
    "Why isn't Elena worried about the supermarkets?"
  ],
  discussion:[
    "Is there a small shop you like in your neighbourhood?",
    "Do you prefer small shops or big supermarkets? Why?",
    "What makes a place feel welcoming to you?"
  ]
},
{
  id:"how-rainbows-form", level:"pre-int", category:"Science", icon:"🌈",
  title:"How Rainbows Form", kicker:"Science · Reading",
  summary:"The simple science behind one of nature's most beautiful sights.",
  paras:[
    "A rainbow is one of the most beautiful things in nature, and it appears when <b>sunlight</b> meets rain. To see one, you usually need both sun and rain at the same time.",
    "Sunlight looks white, but it is really made of many <b>colours</b> mixed together. When light passes through a <b>drop</b> of water, the drop bends the light and splits it into its separate colours.",
    "Each colour bends by a slightly different <b>amount</b>, so they spread out into a band. This is why we always see the colours in the same <b>order</b>: red, orange, yellow, green, blue, and violet.",
    "A rainbow is not really an object in the sky, so you can never <b>reach</b> it. Its position depends on where you stand and where the sun is. If you move, the rainbow moves too, which is part of what makes it so <b>magical</b>."
  ],
  vocab:[
    {w:"sunlight", p:"(n)", d:"the light that comes from the sun"},
    {w:"colour", p:"(n)", d:"red, blue, green and so on"},
    {w:"drop", p:"(n)", d:"a very small amount of liquid"},
    {w:"bend", p:"(v)", d:"to make something change direction"},
    {w:"amount", p:"(n)", d:"how much there is of something"},
    {w:"order", p:"(n)", d:"the way things are arranged, one after another"},
    {w:"reach", p:"(v)", d:"to arrive at or touch something"},
    {w:"magical", p:"(adj)", d:"wonderful and special, like magic"}
  ],
  comprehension:[
    "What two things do you usually need to see a rainbow?",
    "What is white sunlight really made of?",
    "What does a drop of water do to the light?",
    "Why do we always see the colours in the same order?",
    "Why can you never reach a rainbow?"
  ],
  discussion:[
    "When did you last see a rainbow? Where were you?",
    "What other beautiful things can you see in the sky?",
    "Why do you think people feel happy when they see a rainbow?"
  ]
},

/* ===================== SUPER-ADVANCED (C2) ===================== */
{
  id:"the-tyranny-of-the-measurable", level:"super", category:"Society", icon:"📊",
  title:"The Tyranny of the Measurable", kicker:"Society · Reading",
  summary:"When we measure everything, do we start to value only what we can count?",
  paras:[
    "We live in an age enamoured of measurement. From the number of steps we walk to the engagement metrics of our every utterance, contemporary life is increasingly <b>quantified</b>, tabulated, and ranked. This impulse is not inherently misguided; measurement has propelled extraordinary advances in medicine, engineering, and governance. Yet an unexamined faith in numbers carries a subtle <b>peril</b>.",
    "The danger lies in a quiet substitution. Because what can be counted is visible and what cannot is not, we gradually come to treat the measurable as though it were the whole of the <b>valuable</b>. A school reduces education to test scores; a hospital reduces care to throughput; a friendship, subjected to the same logic, might be reduced to the frequency of contact. The <b>metric</b>, designed to serve a purpose, quietly usurps it.",
    "This phenomenon has a name among economists: Goodhart's Law, which holds that when a measure becomes a target, it ceases to be a good measure. Once a number is rewarded, people optimise for the number rather than the underlying good it was meant to <b>represent</b>. The result is a kind of institutional theatre, in which everyone performs the appearance of success while its <b>substance</b> quietly erodes.",
    "None of this argues for abandoning measurement, which would be its own <b>folly</b>. Rather, it argues for humility about its limits. The most important things — dignity, curiosity, trust, meaning — <b>resist</b> quantification not because they are vague, but because they are too rich to be captured by a single figure. A wise society counts what it can, remembers what it cannot, and never <b>mistakes</b> the map for the territory."
  ],
  vocab:[
    {w:"quantified", p:"(adj)", d:"expressed or measured as a number"},
    {w:"peril", p:"(n)", d:"serious danger"},
    {w:"valuable", p:"(adj)", d:"worth a great deal; important"},
    {w:"metric", p:"(n)", d:"a standard used for measuring something"},
    {w:"represent", p:"(v)", d:"to stand for or express something"},
    {w:"substance", p:"(n)", d:"the real, important part of something"},
    {w:"folly", p:"(n)", d:"a foolish act or idea"},
    {w:"resist", p:"(v)", d:"to withstand or not give in to something"}
  ],
  comprehension:[
    "What does the writer say measurement has propelled?",
    "Explain the 'quiet substitution' the writer warns about.",
    "In your own words, what does Goodhart's Law state?",
    "What does the writer mean by 'institutional theatre'?",
    "What does the writer suggest a wise society should do?"
  ],
  discussion:[
    "Where in your own life do you see 'the measurable' crowding out the meaningful?",
    "Can you think of a target that stopped being a good measure once it was rewarded?",
    "Are there things you value precisely because they cannot be measured? Give an example."
  ]
},
{
  id:"on-the-perception-of-time", level:"super", category:"Science", icon:"⏳",
  title:"On the Perception of Time", kicker:"Science · Reading",
  summary:"Why time seems to speed up as we age — and what we can do about it.",
  paras:[
    "Few observations are as universally shared, or as quietly unsettling, as the sense that time accelerates with age. The endless summers of childhood give way to years that seem to <b>evaporate</b>, and one wonders whether the clock itself has somehow been recalibrated. It has not; what changes is the mind that perceives it.",
    "One influential explanation is <b>proportional</b>: to a five-year-old, a single year represents a fifth of all remembered existence, whereas to a fifty-year-old it is a mere fiftieth. Each successive interval is measured against an ever-larger <b>accumulation</b> of prior experience, and so feels correspondingly smaller. Time does not shrink; our yardstick grows.",
    "A second, complementary theory concerns <b>novelty</b>. The brain encodes new and surprising experiences in rich detail, and this density of memory is what we later mistake for duration. Childhood teems with firsts; adulthood, by contrast, settles into routine, and routine leaves few <b>markers</b>. A month of unremarkable commutes collapses, in retrospect, into almost nothing.",
    "If this is correct, the remedy is neither <b>mystical</b> nor complicated. To slow the subjective passage of time is to court novelty deliberately: to travel, to learn unfamiliar skills, to alter one's habits and routes. We cannot add hours to our years, but by filling them with the unrepeated and the vivid, we may yet <b>reclaim</b> some of the expansiveness that once made a single summer feel <b>infinite</b>."
  ],
  vocab:[
    {w:"evaporate", p:"(v)", d:"to disappear gradually"},
    {w:"proportional", p:"(adj)", d:"related in size or amount to something else"},
    {w:"accumulation", p:"(n)", d:"a gradually gathered amount"},
    {w:"novelty", p:"(n)", d:"the quality of being new and unusual"},
    {w:"marker", p:"(n)", d:"something that helps you notice or remember"},
    {w:"mystical", p:"(adj)", d:"having a spiritual meaning beyond understanding"},
    {w:"reclaim", p:"(v)", d:"to get something back"},
    {w:"infinite", p:"(adj)", d:"without limits; endless"}
  ],
  comprehension:[
    "What shared observation does the writer begin with?",
    "Explain the 'proportional' theory of why time seems to speed up.",
    "How does the 'novelty' theory link memory to our sense of duration?",
    "Why does the writer say adulthood 'leaves few markers'?",
    "What practical remedy does the writer propose?"
  ],
  discussion:[
    "Do you feel that time is speeding up in your own life? Why might that be?",
    "Which of the two theories do you find more convincing, and why?",
    "What could you do to make your own weeks feel richer and longer?"
  ]
}

];

/* ---- model answers for the comprehension questions (teacher reveal) ----
   Kept separate from the lessons above so the lesson blocks stay readable.
   Order matches each lesson's "comprehension" array. */
const COMP_ANSWERS = {
  "a-day-at-the-market":[
    "She goes to the market.",
    "The apples are red and the bananas are yellow.",
    "Because the farmer picked it today.",
    "It is cheap, and she can chat with the friendly sellers.",
    "She walks home and makes lunch for her family."],
  "the-busy-honey-bees":[
    "It is called a hive.",
    "They drink nectar.",
    "They make honey.",
    "They carry pollen between flowers, which helps new fruit and vegetables grow.",
    "Because they make honey and help our food grow; without them we would have much less food."],
  "the-four-seasons":[
    "There are four seasons.",
    "Flowers begin to grow.",
    "Because the days are long and the sun is hot.",
    "They turn brown and fall to the ground.",
    "White snow covers the streets."],
  "a-robot-in-the-garden":[
    "It is white and round.",
    "It has a battery inside.",
    "It gives the plants some water.",
    "It waters the plants every day, never forgets and is never tired, so the garden is green and full of vegetables.",
    "He picks the tomatoes."],
  "how-octopuses-solve-problems":[
    "It has three hearts.",
    "It learned to open a glass jar to reach the food inside.",
    "Because it remembered how to do it.",
    "It uses camouflage to hide from danger and escape from enemies.",
    "Squirting water at lights to turn them off, or taking objects apart."],
  "the-sweet-story-of-chocolate":[
    "In warm, rainy regions of Central and South America.",
    "It was thick and bitter, not sweet.",
    "They sometimes used them as money.",
    "They added sugar.",
    "In the 1800s."],
  "music-and-the-brain":[
    "It affects many parts of the brain at the same time.",
    "A chemical that makes us feel pleasure.",
    "It helps them focus and block out noise.",
    "To help patients feel calm before an operation.",
    "They can still sing songs from their childhood."],
  "the-city-that-grew-a-garden":[
    "It was grey, ugly and full of rubbish.",
    "To clean the land and turn it into a community garden.",
    "They came with bags, gloves and tools, removed the rubbish and prepared the ground.",
    "They learned how to grow their own food.",
    "It brought the community closer together and created new friendships."],
  "the-secret-language-of-trees":[
    "As a collection of individual trees competing for light and water.",
    "A network of tiny fungi, sometimes called the 'wood wide web'.",
    "Sugar, water and chemical signals.",
    "It releases chemicals that warn them, so they can prepare their defences.",
    "We may be breaking apart relationships that took centuries to establish."],
  "why-do-we-dream":[
    "For thousands of years.",
    "They help us process emotions and recover from stress.",
    "It sorts through them, deciding what to keep and what to forget.",
    "By letting us rehearse dangerous situations without real risk.",
    "One of the great mysteries of the human mind."],
  "the-return-of-the-wolves":[
    "To bring wolves back to a national park after seventy years.",
    "They feared the wolves would cause harm.",
    "They were eating the young trees along the rivers.",
    "They became more careful and avoided certain areas.",
    "The plants held the soil, so the riverbanks stopped collapsing and the water ran clearer."],
  "how-libraries-are-changing":[
    "Quiet rooms filled with shelves of books.",
    "Tools, musical instruments, telescopes or kitchen equipment.",
    "By offering free computers and internet to people who cannot afford them.",
    "Language classes, job-search workshops and clubs.",
    "Because as more of life moves online, the need for free, trusted public spaces grows."],
  "the-mathematics-of-snowflakes":[
    "That no two snowflakes are alike.",
    "Water vapour freezes around a tiny particle of dust.",
    "Because the water molecules lock together in a hexagonal pattern.",
    "The constantly changing temperature and humidity on its journey as it falls.",
    "That simple rules combined with chaotic conditions can generate astonishing complexity."],
  "the-woman-who-mapped-the-ocean-floor":[
    "It was almost entirely unknown.",
    "Women were not allowed aboard the research ships.",
    "A great mountain range down the centre of the Atlantic, split by a deep valley.",
    "He dismissed it as 'girl talk'.",
    "Her contribution was overshadowed by male colleagues."],
  "the-quiet-power-of-slow-travel":[
    "A race between famous landmarks.",
    "To immerse themselves in daily life and form genuine connections.",
    "Spending money in small local businesses, and travelling by train or on foot to lower the environmental impact.",
    "That it is a luxury requiring time and money many people do not have.",
    "Even a short trip can be approached with curiosity and patience."],
  "living-alongside-artificial-intelligence":[
    "Recommending films, filtering messages, or helping doctors read medical scans.",
    "By analysing huge amounts of information quickly to detect diseases earlier.",
    "Because they learn from existing data and can absorb and amplify human bias.",
    "Privacy, employment, and relying on decisions few people fully understand.",
    "Careful regulation, honest public debate, and keeping key decisions in human hands."],
  "my-family":[
    "There are five people.",
    "She is a nurse.",
    "He is a teacher.",
    "On Sunday."],
  "my-busy-day":[
    "At seven o'clock.",
    "Breakfast and some milk.",
    "English, maths, and art (any two).",
    "The writer does homework."],
  "at-the-park":[
    "On Saturday.",
    "The sun is warm and the sky is blue.",
    "It likes to run on the grass.",
    "When the sun goes down."],
  "the-neighbourhood-bakery":[
    "Every morning before sunrise.",
    "Her grandmother.",
    "Time, warm hands, and patience.",
    "They meet to talk, and enjoy the friendly atmosphere.",
    "Because people want a place where somebody knows their name — something a supermarket cannot offer."],
  "how-rainbows-form":[
    "Sun and rain at the same time.",
    "Many colours mixed together.",
    "It bends the light and splits it into separate colours.",
    "Because each colour bends by a slightly different amount.",
    "Because it is not really an object; its position depends on where you stand."],
  "the-tyranny-of-the-measurable":[
    "Extraordinary advances in medicine, engineering, and governance.",
    "We treat what can be measured as if it were the whole of what is valuable, ignoring what cannot be counted.",
    "When a measure becomes a target, it stops being a good measure.",
    "Everyone performs the appearance of success while its real substance erodes.",
    "Count what it can, remember what it cannot, and never mistake the map for the territory."],
  "on-the-perception-of-time":[
    "That time seems to speed up as we age.",
    "Each year is a smaller fraction of your total life, so it feels smaller against an ever-larger store of experience.",
    "The brain records novel experiences in rich detail, and that density of memory is mistaken for duration.",
    "Because routine is unremarkable and leaves few memorable moments.",
    "Deliberately seeking novelty — travelling, learning new skills, changing routines."]
};

/* helper: attach level meta/tag (and answers) to a lesson before rendering */
function withLevelMeta(lesson){
  const lv = LEVELS.find(l=>l.key===lesson.level) || LEVELS[1];
  return Object.assign({}, lesson, {
    meta:lesson.meta||lv.meta,
    levelTag:lesson.levelTag||lv.tag,
    note:lesson.note||"",
    compAnswers: lesson.compAnswers || COMP_ANSWERS[lesson.id] || null
  });
}
