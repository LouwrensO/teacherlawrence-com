// Curriculum plan — the ordered topic bank the bulk generator fills.
// The ORDER here also becomes the learning Path (lesson 1 → 2 → 3 …).
// Each entry: { title, topic }. topic is one of the library's topic tags.
// Levels covered: beginner → super (phonics/starter stays flashcards).
// Add more entries any time; the generator makes whatever isn't there yet.
//
// "Bible" topic — populated below, one progression per level: beginner
// starts with well-known animal stories (good for teaching animals/numbers
// vocabulary), working up through simple narrative stories at elementary
// through intermediate, to longer, more reflective/holiday-themed pieces
// at upper through super. Bible lessons are shown to every visitor by
// default and are free regardless of subscription status (see
// public/lessons.js / public/lesson.html's dlDetermineAccess()) — this is
// a deliberate, permanent free section, not a trial sample. api/make.js
// has one small topic-aware prompt tweak for these (retell the known story
// simply and respectfully, rather than "write an original article").
export const PLAN = {
  beginner: [
    { title: "My House", topic: "Daily Life" },
    { title: "My Favourite Food", topic: "Daily Life" },
    { title: "The Weather Today", topic: "Nature" },
    { title: "My Best Friend", topic: "People" },
    { title: "Animals on the Farm", topic: "Nature" },
    { title: "Going Shopping", topic: "Daily Life" },
    { title: "My School Day", topic: "Daily Life" },
    { title: "A Sunny Day", topic: "Nature" },
    // Bible — beginner: well-known animal stories, good for teaching
    // animals/numbers vocabulary at this level
    { title: "Noah and the Animals", topic: "Bible" },
    { title: "The Lost Sheep", topic: "Bible" },
    { title: "Jonah and the Big Fish", topic: "Bible" },
    { title: "Daniel and the Kind Lions", topic: "Bible" },
    { title: "The Boy Who Shared His Lunch", topic: "Bible" }
  ],
  elementary: [
    { title: "A Trip to the Zoo", topic: "Nature" },
    { title: "The Baker in Our Town", topic: "People" },
    { title: "How Plants Grow", topic: "Science" },
    { title: "A Day at the Beach", topic: "Daily Life" },
    { title: "The Kind Bus Driver", topic: "People" },
    { title: "Recycling at Home", topic: "Society" },
    { title: "The Helpful Little Robot", topic: "Science" },
    { title: "Festivals Around the World", topic: "Culture" },
    // Bible — elementary: simple, well-loved narrative stories
    { title: "David and Goliath", topic: "Bible" },
    { title: "Joseph's Colorful Coat", topic: "Bible" },
    { title: "The Good Samaritan", topic: "Bible" },
    { title: "Moses and the Basket", topic: "Bible" }
  ],
  "pre-int": [
    { title: "The Story of Tea", topic: "Culture" },
    { title: "Why Cats Purr", topic: "Science" },
    { title: "The Girl Who Planted a Forest", topic: "People" },
    { title: "How a Bicycle Works", topic: "Science" },
    { title: "Life in a Big City", topic: "Daily Life" },
    { title: "The First Aeroplane", topic: "Science" },
    { title: "Saving the Sea Turtles", topic: "Nature" },
    { title: "The Story Behind a Famous Painting", topic: "Culture" },
    // Bible — pre-intermediate: slightly longer stories
    { title: "The Walls of Jericho", topic: "Bible" },
    { title: "Ruth and Naomi", topic: "Bible" },
    { title: "The Wise King Solomon", topic: "Bible" },
    { title: "The First Christmas", topic: "Bible" }
  ],
  intermediate: [
    { title: "The Science of Sleep", topic: "Science" },
    { title: "The Great Barrier Reef", topic: "Nature" },
    { title: "The Inventor of the Telephone", topic: "People" },
    { title: "How Money Began", topic: "Society" },
    { title: "The Power of Volunteering", topic: "Society" },
    { title: "The Northern Lights", topic: "Nature" },
    { title: "The History of Pizza", topic: "Culture" },
    { title: "Robots That Help Doctors", topic: "Science" },
    // Bible — intermediate: fuller stories and teachings
    { title: "The Story of Easter", topic: "Bible" },
    { title: "Esther, the Brave Queen", topic: "Bible" },
    { title: "The Parables Jesus Told", topic: "Bible" },
    { title: "Paul's Long Journey", topic: "Bible" }
  ],
  upper: [
    { title: "The Psychology of Habits", topic: "Science" },
    { title: "Rewilding the Wild", topic: "Nature" },
    { title: "The Woman Who Coded the Future", topic: "People" },
    { title: "The True Cost of Fast Fashion", topic: "Society" },
    { title: "How Cities Are Going Green", topic: "Society" },
    { title: "The Mystery of Déjà Vu", topic: "Science" },
    { title: "The Rise of Street Art", topic: "Culture" },
    { title: "The Secret Language of Whales", topic: "Nature" },
    // Bible — upper-intermediate: thematic/holiday and background pieces
    { title: "Christmas Traditions Around the World", topic: "Bible" },
    { title: "The Psalms: Poetry of the Bible", topic: "Bible" },
    { title: "How the Bible Was Written and Copied", topic: "Bible" },
    { title: "The Story of Pentecost", topic: "Bible" }
  ],
  advanced: [
    { title: "The Paradox of Choice", topic: "Society" },
    { title: "The Architecture of Memory", topic: "Science" },
    { title: "The Vanishing Art of Handwriting", topic: "Culture" },
    { title: "The Economics of Happiness", topic: "Society" },
    { title: "Secrets of the Deep Ocean", topic: "Nature" },
    { title: "The Genius of Ada Lovelace", topic: "People" },
    { title: "The Philosophy of Time", topic: "Science" },
    { title: "The Future of Work", topic: "Society" },
    // Bible — advanced: longer, more reflective/holiday-themed pieces
    { title: "Advent: The Season of Waiting", topic: "Bible" },
    { title: "The Bible in Art and Music", topic: "Bible" },
    { title: "Translating the Bible into Every Language", topic: "Bible" },
    { title: "Harvest Festivals and Thanksgiving", topic: "Bible" }
  ],
  super: [
    { title: "On the Limits of Language", topic: "Society" },
    { title: "The Aesthetics of Imperfection", topic: "Culture" },
    { title: "Consciousness and the Machine", topic: "Science" },
    { title: "The Tragedy of the Commons", topic: "Society" },
    { title: "The Mathematics of Beauty", topic: "Science" },
    { title: "Memory, Myth, and Identity", topic: "Culture" },
    { title: "The Ethics of Longevity", topic: "Society" },
    { title: "The Sublime in Nature", topic: "Nature" },
    // Bible — super/C2: sophisticated, essay-like treatments
    { title: "Wisdom Literature: Job, Proverbs, and Ecclesiastes", topic: "Bible" },
    { title: "The Bible's Influence on the English Language", topic: "Bible" },
    { title: "Parable and Metaphor as Teaching Tools", topic: "Bible" }
  ]
};

// order the levels progress in
export const LEVEL_ORDER = ["beginner", "elementary", "pre-int", "intermediate", "upper", "advanced", "super"];
