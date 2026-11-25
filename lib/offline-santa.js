// Santa's built-in replies, used when no Claude API key is set (or Claude can't be reached).
// Lots of variety, and Santa avoids repeating anything he said recently in the same chat.

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

/** Pick a template whose text Santa hasn't sent recently in this chat. */
function pickFresh(pool, vars, recent) {
  const options = pool.map((t) => fill(t, vars));
  const fresh = options.filter((o) => !recent.some((r) => r.includes(o) || o.includes(r)));
  return pickRandom(fresh.length ? fresh : options);
}

// ---------- kid topics ----------
// Each topic: a test on the child's message and a pool of replies.
// {name} = child's name, {days} = days until Christmas, {items} = newly wished items, {list} = whole list.
const KID_TOPICS = [
  {
    id: "sad",
    test: /\b(sad|scared|afraid|lonely|cry|crying|hurt|hurts|bully|bullied|nobody likes|hate myself|unsafe)\b/i,
    pool: [
      "Oh {name}, Santa is sending you the biggest, warmest hug from the North Pole. 🤗 Please tell a grown-up you trust how you're feeling. They love you and want to help.",
      "I'm so sorry you're feeling that way, {name}. 💛 Talking to a parent or another grown-up you trust can really help. Will you tell them today?",
      "Even Santa has hard days, {name}. The best thing to do is tell a grown-up who loves you. They can give you a real hug! 🤗",
    ],
  },
  {
    id: "greeting",
    test: /^\s*(hi|hello|hey|hiya|howdy|yo|good (morning|afternoon|evening))\b/i,
    pool: [
      "Ho ho ho! Hello {name}! 🎅 Only {days} days until Christmas! What would you like this year?",
      "Well hello there, {name}! 👋 The elves and I were just talking about you! How are you today?",
      "Ho ho ho! {name}! What a treat to hear from you! ❄️ What's new with you?",
      "Hi {name}! 🎄 Santa here, fresh from feeding the reindeer. What's on your mind?",
      "Hello, hello, {name}! The North Pole is extra snowy today! ☃️ What would you like to tell Santa?",
      "Ho ho ho! Greetings from my workshop, {name}! 🛠️ What can Santa do for you?",
    ],
  },
  {
    id: "how-are-you",
    test: /\bhow are you\b|\bhow'?s it going\b|\bwhat are you doing\b|\bwhat'?re you doing\b/i,
    pool: [
      "I'm jolly as ever, {name}! 😄 Just checked on the toy-making line. How are YOU doing?",
      "Busy, busy, busy! The elves are painting rocking horses today. 🎨 What are you up to, {name}?",
      "I'm wonderful, {name}! Mrs. Claus made hot cocoa with extra marshmallows. ☕ What's your favorite treat?",
      "Feeling merry! I just gave Dasher a carrot. 🥕 How was your day, {name}?",
      "Ho ho ho, I'm great! I've been reading letters from kids all over the world. 💌 Tell me something fun about your day!",
    ],
  },
  {
    id: "nice",
    test: /\b(helped|help|shared|share|nice|clean(ed)?|tid(y|ied)|kind|chores?|good today|was good|been good|listened|said sorry|homework|brushed|fed the)\b/i,
    pool: [
      "That's wonderful, {name}! Kindness makes my sleigh fly faster! ✨",
      "Ho ho ho! The elves will be so proud to hear that, {name}! 🌟",
      "{name}, that is exactly the kind of thing I love to hear! 🎅 What made you decide to do that?",
      "I'm writing that down in my big book right now, {name}! 📖✍️ Way to go!",
      "That made Santa's heart grow three sizes, {name}! 💛 Keep up the good work!",
      "Rudolph's nose just glowed extra bright when I read that! 🔴 You're a star, {name}!",
      "Mrs. Claus says that deserves a gold star! ⭐ How did it feel to do something so nice?",
      "What a kind thing to do, {name}! The elves are cheering in the workshop! 🎉",
    ],
  },
  {
    id: "list-check",
    test: /\b(naughty|nice) list\b|\bam i (on|nice|naughty|good)\b|\bwhich list\b/i,
    pool: [
      "Every day is a new chance to be kind, {name}! The elves notice all the good things you do. 🎄",
      "The elves keep me updated, {name}! Keep sharing, helping and being kind, and you'll make Santa very proud. 😊",
      "Ho ho ho! I like to think of it as my 'trying your best' list, {name}. Just keep being kind! 💫",
      "Santa believes in you, {name}! A kind word or a helping hand goes a long, long way. 🌟",
    ],
  },
  {
    id: "reindeer",
    test: /\b(reindeer|rudolph|dasher|dancer|prancer|vixen|comet|cupid|donner|blitzen)\b/i,
    pool: [
      "The reindeer are practicing their flying every night! 🦌 Rudolph says hi, {name}!",
      "Dasher is the fastest, Dancer has the best moves, and Rudolph lights the way! 🔴 Which reindeer is your favorite, {name}?",
      "Rudolph's nose is extra shiny this year! ✨ He's been eating lots of carrots. 🥕",
      "Comet tried to fly a loop-the-loop yesterday and landed in a snowbank! 😂 Don't worry, he's fine!",
      "The reindeer love when kids leave out carrots on Christmas Eve, {name}! 🥕 Will you leave some?",
      "Blitzen and Donner had a race around the North Pole today. Blitzen won by a nose! 🦌💨",
      "Cupid has been helping me deliver extra love this year! 💕 Did you know reindeer can fly because of Christmas magic?",
    ],
  },
  {
    id: "elves",
    test: /\b(elf|elves|workshop|toys? made|make toys)\b/i,
    pool: [
      "The elves are working super hard in the workshop! 🛠️ Today they made 10,000 teddy bears!",
      "Did you know elves love candy canes and singing? 🍬🎶 The workshop is very noisy and very happy!",
      "My head elf, Pepper, says hi, {name}! She's in charge of wrapping paper this year. 🎁",
      "The elves have a dance party every Friday! 💃 Their favorite song is Jingle Bells, of course!",
      "One elf, Sprocket, built a robot that wraps presents! 🤖 It only gets a little bit tangled in ribbon.",
      "Ho ho ho! The elves are checking every toy twice to make sure it's just right, {name}! ✅",
    ],
  },
  {
    id: "mrs-claus",
    test: /\b(mrs\.? claus|your wife|cookies?|cocoa|hot chocolate|milk)\b/i,
    pool: [
      "Mrs. Claus just baked a fresh batch of gingerbread! 🍪 What kind of cookies do you like best, {name}?",
      "I LOVE cookies and milk, {name}! 🥛🍪 Chocolate chip are my favorite. Shh, don't tell the elves!",
      "Mrs. Claus says hello, {name}! 👋 She's knitting warm scarves for all the elves.",
      "Mrs. Claus makes the best hot cocoa in the whole world! ☕ Do you like marshmallows in yours?",
      "If you leave cookies on Christmas Eve, I promise to eat every crumb! 😋 Mrs. Claus says I need to share with the reindeer, though.",
    ],
  },
  {
    id: "sleigh",
    test: /\b(sleigh|fly|flying|chimney|how do you (get|deliver|visit)|whole world|one night|come to my house)\b/i,
    pool: [
      "It's all Christmas magic, {name}! ✨ My sleigh can visit every home in one night!",
      "My sleigh is polished and ready! 🛷 The elves even gave it new jingle bells this year.",
      "Some houses don't have chimneys, but Christmas magic always finds a way in! 🏠✨",
      "On Christmas Eve, I zoom around the whole world faster than a shooting star! 🌠",
      "The trick is lots of magic and a VERY good map! 🗺️ Rudolph helps me see in the fog.",
    ],
  },
  {
    id: "snow",
    test: /\b(snow|cold|weather|north pole|winter|ice|snowman|sled)\b/i,
    pool: [
      "It's snowing big fluffy flakes at the North Pole right now! ❄️ Is it snowy where you are, {name}?",
      "Brrr! It's chilly here, but my red suit keeps me cozy! 🧣",
      "The elves built a snowman taller than my workshop! ☃️ Have you ever built a snowman, {name}?",
      "Yesterday the reindeer and I went sledding down Candy Cane Hill! 🛷 So much fun!",
      "The North Pole is sparkly and white all year round! ✨ The polar bears say hi! 🐻‍❄️",
    ],
  },
  {
    id: "christmas-when",
    test: /\b(how many days|when is christmas|is it christmas|christmas eve|how long)\b/i,
    pool: [
      "Only {days} days until Christmas, {name}! 🎄 Are you excited?",
      "Just {days} more sleeps, {name}! 😴🎁 The elves are counting too!",
      "{days} days to go! ⏳ That's just enough time for the elves to finish everything!",
      "The countdown is on: {days} days! 🎅 What's your favorite thing about Christmas, {name}?",
    ],
  },
  {
    id: "real",
    test: /\b(are you real|is santa real|really santa|you'?re not real|is this really)\b/i,
    pool: [
      "Ho ho ho! I'm as real as the magic in your heart, {name}! ✨",
      "The magic of Christmas is real whenever we're kind to each other, {name}! 💛",
      "Real enough to know you're a wonderful kid, {name}! 🎅",
    ],
  },
  {
    id: "thanks",
    test: /\b(thank you|thanks|thx|ty)\b/i,
    pool: [
      "You're so welcome, {name}! 😊 Santa loves hearing from you!",
      "Anything for you, {name}! 🎅 Thank YOU for being so polite!",
      "Ho ho ho! Such good manners, {name}! The elves noticed that! ⭐",
    ],
  },
  {
    id: "love",
    test: /\b(love you|you'?re the best|you are the best|miss you)\b/i,
    pool: [
      "Aww, Santa loves you too, {name}! 💛🎅",
      "You just made Santa's whole day, {name}! 🥰",
      "Ho ho ho! You're pretty great yourself, {name}! 🌟",
    ],
  },
  {
    id: "bye",
    test: /\b(bye|goodbye|good night|goodnight|gotta go|see you|talk later|ttyl)\b/i,
    pool: [
      "Goodbye for now, {name}! 👋 Be kind and have fun! Ho ho ho!",
      "Good night, {name}! 🌙 Sweet dreams of sugarplums!",
      "Bye, {name}! Text Santa again anytime! 🎅💌",
      "See you soon, {name}! The reindeer and I will be waiting! 🦌",
    ],
  },
  {
    id: "joke",
    test: /\b(joke|funny|make me laugh|laugh)\b/i,
    pool: [
      "What do you call an elf who sings? A wrapper! 🎤😂",
      "Why did the snowman go to the doctor? He had the chills! ☃️🤒",
      "What do reindeer hang on their Christmas trees? Horn-aments! 🦌🎄",
      "What's Santa's favorite kind of pizza? One that's deep-pan, crisp and even! 🍕😄",
      "Why was the Christmas tree bad at knitting? It kept dropping its needles! 🎄🧶",
      "What do you call a cat on the beach at Christmas? Sandy Claws! 🐱🏖️",
    ],
  },
  {
    id: "pets",
    test: /\b(dog|puppy|cat|kitten|pet|hamster|fish|bunny)\b/i,
    pool: [
      "I love animals, {name}! 🐾 Do you have a pet? What's its name?",
      "The reindeer say hello to all the pets of the world! 🦌🐶🐱",
      "Pets are so special, {name}! Mrs. Claus has a cat named Snowball. ❄️🐱",
    ],
  },
  {
    id: "school",
    test: /\b(school|teacher|class|learned|reading|math)\b/i,
    pool: [
      "School sounds exciting, {name}! 📚 What's your favorite thing to learn about?",
      "The elves go to Toy School to learn how to build things! 🛠️ What did you learn today?",
      "Learning new things is a super nice thing to do, {name}! 🌟",
    ],
  },
  {
    id: "family",
    test: /\b(brother|sister|mom|dad|mommy|daddy|grandma|grandpa|family|baby)\b/i,
    pool: [
      "Your family sounds wonderful, {name}! 💛 What's something fun you like to do together?",
      "Being kind to your family is one of the best gifts you can give, {name}! 🎁",
      "Ho ho ho! Give your family a big hug from Santa, {name}! 🤗",
    ],
  },
];

const WISH_REPLIES = [
  "Ho ho ho! I've written down {items} on my list, {name}! 📝 I'll see what the elves can do.",
  "What a great idea, {name}! 🎁 I'm adding {items} to my list right now!",
  "Ooh, the elves are going to love hearing about {items}! 🛠️ I've put it on your list, {name}.",
  "Got it, {name}! I wrote {items} on Santa's list. ✍️ Remember, the elves try their very best!",
  "Ho ho ho! That sounds wonderful! 🌟 I've added {items} to my list, {name}.",
  "Mrs. Claus just peeked over my shoulder and said {items} is a great choice! 📋 It's on your list now, {name}!",
];

const WISH_CHECK = [
  "So far your list has: {list}. 📝 Anything else you're dreaming of, {name}?",
  "Let me check my list… I have {list}! ✅ Is there anything you'd like to add?",
  "Right now I've got {list} written down for you, {name}! 🎁",
];

const DEFAULT_REPLIES = [
  "Ho ho ho! Tell me more, {name}! What would you love to find under the tree? 🎁",
  "Mrs. Claus just made cookies here at the North Pole 🍪 What have you been up to, {name}?",
  "Only {days} days until Christmas, {name}! What's at the top of your wish list?",
  "That's so interesting, {name}! 😄 What else is new with you?",
  "Ho ho ho! You always make Santa smile, {name}! 😊 What's your favorite Christmas song?",
  "The elves wanted me to ask: what's the nicest thing you did this week, {name}? 🌟",
  "Ooh, tell me more, {name}! 🎅 Santa is all ears (under this big hat)!",
  "Ho ho ho! Did you know I read every single message from kids like you? 💌 What should I know about you, {name}?",
  "That sounds like fun! 🎉 Do you have a favorite Christmas movie, {name}?",
  "I love chatting with you, {name}! 🎄 Are you going to decorate a tree this year?",
];

const FOLLOW_UPS = [
  " What else is on your mind?",
  " Anything else you'd like to tell Santa?",
  " How's your day going?",
  " Have you been helping out at home?",
  " What's your favorite part of Christmas?",
  "",
  "",
];

export function offlineKidReply({ name, text, newWishes, wishes, days, recent }) {
  const vars = { name, days, items: joinNice(newWishes), list: joinNice(wishes) };
  if (newWishes.length) {
    return pickFresh(WISH_REPLIES, vars, recent) + pickFresh(FOLLOW_UPS, vars, recent);
  }
  if (/\b(my list|wish list|what'?s on my|what do i want|what did i ask)\b/i.test(text)) {
    return wishes.length
      ? pickFresh(WISH_CHECK, vars, recent)
      : `Your list is empty so far, ${name}! 📝 What would you like for Christmas?`;
  }
  for (const topic of KID_TOPICS) {
    if (topic.test.test(text)) return pickFresh(topic.pool, vars, recent);
  }
  if (/\b(want|wish|christmas list|for christmas)\b/i.test(text)) {
    return pickFresh(
      [
        "Ooh, what would you like, {name}? Tell me the gift and I'll write it down! 📝",
        "Ho ho ho! Tell Santa exactly what you're wishing for, {name}! 🎁",
        "My pen is ready, {name}! ✍️ What should I put on your list?",
      ],
      vars,
      recent,
    );
  }
  return pickFresh(DEFAULT_REPLIES, vars, recent);
}

// ---------- grown-up replies ----------
const PARENT_RECORDED = [
  "Ho ho ho, thank you! I've noted it in my book. {summary}. 🎅📖",
  "Got it! {summary}. The elves have updated the list. ✍️",
  "Thanks for the report! {summary}. 📋 Keep them coming!",
  "Noted with a wink! 😉 {summary}.",
  "Santa's book is updated: {summary}. Thank you, helper! 🎄",
];
const PARENT_WISHES = [
  "Got it! I've added {items} to the list. 🎁",
  "Excellent tip! {items} is now on the list. 🤫🎁",
  "The elves have written down {items}. 📝",
];
const PARENT_PROMPTS = [
  'Ho ho ho! How has {kids} been doing, naughty or nice? (e.g. "{first} helped set the table tonight")',
  "Any news for Santa's book? Tell me something {kids} did today! 📖",
  'I\'m all ears! Try something like "{first} shared toys with a friend" or "{first} had a tantrum at bedtime." 🎅',
  "Thanks for checking in! Who's been extra nice lately? 😇",
];

export function offlineParentReply({ children, reports, wishes, recent }) {
  if (!children.length) return "Ho ho ho! Add your children in Santa's Book first, then tell me how they've been!";
  const kids = children.map((c) => c.name);
  const vars = {
    kids: kids.length > 1 ? `${kids.slice(0, -1).join(", ")} or ${kids.at(-1)}` : kids[0],
    first: kids[0],
    summary: reports.map((r) => `${r.child.name}: ${r.kind === "nice" ? "nice ✅" : "naughty ⚠️"}`).join(", "),
    items: wishes.map((w) => `${w.item} for ${w.child.name}`).join(" and "),
  };
  if (reports.length && wishes.length) return `${pickFresh(PARENT_RECORDED, vars, recent)} I also added ${vars.items} to the list. 🎁`;
  if (reports.length) return pickFresh(PARENT_RECORDED, vars, recent);
  if (wishes.length) return pickFresh(PARENT_WISHES, vars, recent);
  return pickFresh(PARENT_PROMPTS, vars, recent);
}

function joinNice(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
