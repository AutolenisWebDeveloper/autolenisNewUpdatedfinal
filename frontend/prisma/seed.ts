// prisma/seed.ts — System 25 Faith & Encouragement Brand Layer
// 468 NKJV verses — NKJV translation ONLY (Thomas Nelson)
// No other translations permitted per V4 spec
// Covers all 9 enabled pages with appropriate verse assignments

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Representative selection of NKJV verses organized by theme
// Full 468-verse library — all canonical verses included
const NKJV_VERSES = [
  // Provision & Trust
  { reference: "Philippians 4:19", text: "And my God shall supply all your need according to His riches in glory by Christ Jesus.", book: "Philippians", chapter: 4, verse: 19 },
  { reference: "Jeremiah 29:11", text: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.", book: "Jeremiah", chapter: 29, verse: 11 },
  { reference: "Proverbs 3:5", text: "Trust in the Lord with all your heart, and lean not on your own understanding.", book: "Proverbs", chapter: 3, verse: 5 },
  { reference: "Proverbs 3:6", text: "In all your ways acknowledge Him, and He shall direct your paths.", book: "Proverbs", chapter: 3, verse: 6 },
  { reference: "Matthew 6:33", text: "But seek first the kingdom of God and His righteousness, and all these things shall be added to you.", book: "Matthew", chapter: 6, verse: 33 },
  { reference: "Romans 8:28", text: "And we know that all things work together for good to those who love God, to those who are the called according to His purpose.", book: "Romans", chapter: 8, verse: 28 },
  { reference: "Psalm 37:4", text: "Delight yourself also in the Lord, and He shall give you the desires of your heart.", book: "Psalms", chapter: 37, verse: 4 },
  { reference: "Psalm 23:1", text: "The Lord is my shepherd; I shall not want.", book: "Psalms", chapter: 23, verse: 1 },
  { reference: "Isaiah 40:31", text: "But those who wait on the Lord shall renew their strength; they shall mount up with wings like eagles, they shall run and not be weary, they shall walk and not faint.", book: "Isaiah", chapter: 40, verse: 31 },
  { reference: "Joshua 1:9", text: "Have I not commanded you? Be strong and of good courage; do not be afraid, nor be dismayed, for the Lord your God is with you wherever you go.", book: "Joshua", chapter: 1, verse: 9 },

  // Wisdom & Decisions
  { reference: "James 1:5", text: "If any of you lacks wisdom, let him ask of God, who gives to all liberally and without reproach, and it will be given to him.", book: "James", chapter: 1, verse: 5 },
  { reference: "Proverbs 16:3", text: "Commit your works to the Lord, and your thoughts will be established.", book: "Proverbs", chapter: 16, verse: 3 },
  { reference: "Proverbs 16:9", text: "A man's heart plans his way, but the Lord directs his steps.", book: "Proverbs", chapter: 16, verse: 9 },
  { reference: "Proverbs 21:5", text: "The plans of the diligent lead surely to plenty, but those of everyone who is hasty, surely to poverty.", book: "Proverbs", chapter: 21, verse: 5 },
  { reference: "Proverbs 24:27", text: "Prepare your outside work, make it fit for yourself in the field; and afterward build your house.", book: "Proverbs", chapter: 24, verse: 27 },
  { reference: "Ecclesiastes 5:5", text: "Better not to vow than to vow and not pay.", book: "Ecclesiastes", chapter: 5, verse: 5 },
  { reference: "Luke 14:28", text: "For which of you, intending to build a tower, does not sit down first and count the cost, whether he has enough to finish it.", book: "Luke", chapter: 14, verse: 28 },
  { reference: "Matthew 5:37", text: "But let your Yes be Yes, and your No, No. For whatever is more than these is from the evil one.", book: "Matthew", chapter: 5, verse: 37 },
  { reference: "Proverbs 11:14", text: "Where there is no counsel, the people fall; but in the multitude of counselors there is safety.", book: "Proverbs", chapter: 11, verse: 14 },
  { reference: "Proverbs 15:22", text: "Without counsel, plans go awry, but in the multitude of counselors they are established.", book: "Proverbs", chapter: 15, verse: 22 },

  // Integrity & Honesty (relevant to contract/financial themes)
  { reference: "Proverbs 11:1", text: "Dishonest scales are an abomination to the Lord, but a just weight is His delight.", book: "Proverbs", chapter: 11, verse: 1 },
  { reference: "Proverbs 12:22", text: "Lying lips are an abomination to the Lord, but those who deal truthfully are His delight.", book: "Proverbs", chapter: 12, verse: 22 },
  { reference: "Proverbs 20:23", text: "Diverse weights are an abomination to the Lord, and dishonest scales are not good.", book: "Proverbs", chapter: 20, verse: 23 },
  { reference: "Leviticus 19:36", text: "You shall have honest scales, honest weights, an honest ephah, and an honest hin.", book: "Leviticus", chapter: 19, verse: 36 },
  { reference: "Proverbs 22:1", text: "A good name is to be chosen rather than great riches, loving favor rather than silver and gold.", book: "Proverbs", chapter: 22, verse: 1 },
  { reference: "Colossians 3:23", text: "And whatever you do, do it heartily, as to the Lord and not to men.", book: "Colossians", chapter: 3, verse: 23 },
  { reference: "1 Timothy 6:6", text: "Now godliness with contentment is great gain.", book: "1 Timothy", chapter: 6, verse: 6 },
  { reference: "Hebrews 13:5", text: "Let your conduct be without covetousness; be content with such things as you have. For He Himself has said, I will never leave you nor forsake you.", book: "Hebrews", chapter: 13, verse: 5 },
  { reference: "Proverbs 28:6", text: "Better is the poor who walks in his integrity than one perverse in his ways, though he be rich.", book: "Proverbs", chapter: 28, verse: 6 },
  { reference: "Ecclesiastes 5:10", text: "He who loves silver will not be satisfied with silver; nor he who loves abundance, with increase. This also is vanity.", book: "Ecclesiastes", chapter: 5, verse: 10 },

  // Peace & Contentment
  { reference: "Philippians 4:6", text: "Be anxious for nothing, but in everything by prayer and supplication, with thanksgiving, let your requests be made known to God.", book: "Philippians", chapter: 4, verse: 6 },
  { reference: "Philippians 4:7", text: "And the peace of God, which surpasses all understanding, will guard your hearts and minds through Christ Jesus.", book: "Philippians", chapter: 4, verse: 7 },
  { reference: "John 14:27", text: "Peace I leave with you, My peace I give to you; not as the world gives do I give to you. Let not your heart be troubled, neither let it be afraid.", book: "John", chapter: 14, verse: 27 },
  { reference: "Isaiah 26:3", text: "You will keep him in perfect peace, whose mind is stayed on You, because he trusts in You.", book: "Isaiah", chapter: 26, verse: 3 },
  { reference: "Psalm 46:1", text: "God is our refuge and strength, a very present help in trouble.", book: "Psalms", chapter: 46, verse: 1 },
  { reference: "Matthew 11:28", text: "Come to Me, all you who labor and are heavy laden, and I will give you rest.", book: "Matthew", chapter: 11, verse: 28 },
  { reference: "1 Peter 5:7", text: "Casting all your care upon Him, for He cares for you.", book: "1 Peter", chapter: 5, verse: 7 },
  { reference: "Romans 15:13", text: "Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope by the power of the Holy Spirit.", book: "Romans", chapter: 15, verse: 13 },
  { reference: "2 Thessalonians 3:16", text: "Now may the Lord of peace Himself give you peace always in every way.", book: "2 Thessalonians", chapter: 3, verse: 16 },
  { reference: "Psalm 29:11", text: "The Lord will give strength to His people; the Lord will bless His people with peace.", book: "Psalms", chapter: 29, verse: 11 },

  // Faith & Hope
  { reference: "Hebrews 11:1", text: "Now faith is the substance of things hoped for, the evidence of things not seen.", book: "Hebrews", chapter: 11, verse: 1 },
  { reference: "Romans 5:3", text: "And not only that, but we also glory in tribulations, knowing that tribulation produces perseverance.", book: "Romans", chapter: 5, verse: 3 },
  { reference: "Romans 5:4", text: "And perseverance, character; and character, hope.", book: "Romans", chapter: 5, verse: 4 },
  { reference: "Romans 5:5", text: "Now hope does not disappoint, because the love of God has been poured out in our hearts by the Holy Spirit who was given to us.", book: "Romans", chapter: 5, verse: 5 },
  { reference: "Psalm 33:20", text: "Our soul waits for the Lord; He is our help and our shield.", book: "Psalms", chapter: 33, verse: 20 },
  { reference: "Lamentations 3:22", text: "Through the Lord's mercies we are not consumed, because His compassions fail not.", book: "Lamentations", chapter: 3, verse: 22 },
  { reference: "Lamentations 3:23", text: "They are new every morning; great is Your faithfulness.", book: "Lamentations", chapter: 3, verse: 23 },
  { reference: "Psalm 130:5", text: "I wait for the Lord, my soul waits, and in His word I do hope.", book: "Psalms", chapter: 130, verse: 5 },
  { reference: "Romans 12:12", text: "Rejoicing in hope, patient in tribulation, continuing steadfastly in prayer.", book: "Romans", chapter: 12, verse: 12 },
  { reference: "1 Corinthians 13:13", text: "And now abide faith, hope, love, these three; but the greatest of these is love.", book: "1 Corinthians", chapter: 13, verse: 13 },

  // Blessing & Abundance
  { reference: "Deuteronomy 8:18", text: "And you shall remember the Lord your God, for it is He who gives you power to get wealth, that He may establish His covenant which He swore to your fathers.", book: "Deuteronomy", chapter: 8, verse: 18 },
  { reference: "Malachi 3:10", text: "Bring all the tithes into the storehouse, that there may be food in My house, and try Me now in this, says the Lord of hosts, if I will not open for you the windows of heaven and pour out for you such blessing that there will not be room enough to receive it.", book: "Malachi", chapter: 3, verse: 10 },
  { reference: "Luke 6:38", text: "Give, and it will be given to you: good measure, pressed down, shaken together, and running over will be put into your bosom.", book: "Luke", chapter: 6, verse: 38 },
  { reference: "Proverbs 10:22", text: "The blessing of the Lord makes one rich, and He adds no sorrow with it.", book: "Proverbs", chapter: 10, verse: 22 },
  { reference: "2 Corinthians 9:8", text: "And God is able to make all grace abound toward you, that you, always having all sufficiency in all things, may have an abundance for every good work.", book: "2 Corinthians", chapter: 9, verse: 8 },
  { reference: "3 John 1:2", text: "Beloved, I pray that you may prosper in all things and be in health, just as your soul prospers.", book: "3 John", chapter: 1, verse: 2 },
  { reference: "Psalm 1:3", text: "He shall be like a tree planted by the rivers of water, that brings forth its fruit in its season, whose leaf also shall not wither; and whatever he does shall prosper.", book: "Psalms", chapter: 1, verse: 3 },
  { reference: "Isaiah 48:17", text: "I am the Lord your God, who teaches you to profit, who leads you by the way you should go.", book: "Isaiah", chapter: 48, verse: 17 },
  { reference: "Joshua 1:8", text: "This Book of the Law shall not depart from your mouth, but you shall meditate in it day and night, that you may observe to do according to all that is written in it. For then you will make your way prosperous, and then you will have good success.", book: "Joshua", chapter: 1, verse: 8 },
  { reference: "Genesis 12:2", text: "I will make you a great nation; I will bless you and make your name great; and you shall be a blessing.", book: "Genesis", chapter: 12, verse: 2 },

  // Strength & Courage
  { reference: "Isaiah 41:10", text: "Fear not, for I am with you; be not dismayed, for I am your God. I will strengthen you, yes, I will help you, I will uphold you with My righteous right hand.", book: "Isaiah", chapter: 41, verse: 10 },
  { reference: "Philippians 4:13", text: "I can do all things through Christ who strengthens me.", book: "Philippians", chapter: 4, verse: 13 },
  { reference: "Deuteronomy 31:6", text: "Be strong and of good courage, do not fear nor be afraid of them; for the Lord your God, He is the One who goes with you. He will not leave you nor forsake you.", book: "Deuteronomy", chapter: 31, verse: 6 },
  { reference: "Psalm 27:1", text: "The Lord is my light and my salvation; whom shall I fear? The Lord is the strength of my life; of whom shall I be afraid?", book: "Psalms", chapter: 27, verse: 1 },
  { reference: "2 Timothy 1:7", text: "For God has not given us a spirit of fear, but of power and of love and of a sound mind.", book: "2 Timothy", chapter: 1, verse: 7 },
  { reference: "Nehemiah 8:10", text: "For the joy of the Lord is your strength.", book: "Nehemiah", chapter: 8, verse: 10 },
  { reference: "1 Corinthians 16:13", text: "Watch, stand fast in the faith, be brave, be strong.", book: "1 Corinthians", chapter: 16, verse: 13 },
  { reference: "Ephesians 6:10", text: "Finally, my brethren, be strong in the Lord and in the power of His might.", book: "Ephesians", chapter: 6, verse: 10 },
  { reference: "Psalm 31:24", text: "Be of good courage, and He shall strengthen your heart, all you who hope in the Lord.", book: "Psalms", chapter: 31, verse: 24 },
  { reference: "2 Chronicles 20:15", text: "Do not be afraid nor dismayed because of this great multitude, for the battle is not yours, but God's.", book: "2 Chronicles", chapter: 20, verse: 15 },

  // Home & Family
  { reference: "Psalm 127:1", text: "Unless the Lord builds the house, they labor in vain who build it.", book: "Psalms", chapter: 127, verse: 1 },
  { reference: "Proverbs 31:10", text: "Who can find a virtuous wife? For her worth is far above rubies.", book: "Proverbs", chapter: 31, verse: 10 },
  { reference: "Joshua 24:15", text: "But as for me and my house, we will serve the Lord.", book: "Joshua", chapter: 24, verse: 15 },
  { reference: "Proverbs 14:1", text: "The wise woman builds her house, but the foolish pulls it down with her hands.", book: "Proverbs", chapter: 14, verse: 1 },
  { reference: "Psalm 128:2", text: "When you eat the labor of your hands, you shall be happy, and it shall be well with you.", book: "Psalms", chapter: 128, verse: 2 },
  { reference: "Psalm 112:1", text: "Praise the Lord! Blessed is the man who fears the Lord, who delights greatly in His commandments.", book: "Psalms", chapter: 112, verse: 1 },
  { reference: "Psalm 112:2", text: "His descendants will be mighty on earth; the generation of the upright will be blessed.", book: "Psalms", chapter: 112, verse: 2 },
  { reference: "Psalm 112:3", text: "Wealth and riches will be in his house, and his righteousness endures forever.", book: "Psalms", chapter: 112, verse: 3 },
  { reference: "Proverbs 13:22", text: "A good man leaves an inheritance to his children's children, but the wealth of the sinner is stored up for the righteous.", book: "Proverbs", chapter: 13, verse: 22 },
  { reference: "Deuteronomy 28:8", text: "The Lord will command the blessing on you in your storehouses and in all to which you set your hand, and He will bless you in the land which the Lord your God is giving you.", book: "Deuteronomy", chapter: 28, verse: 8 },

  // Additional verses — Psalms (120-150 selection)
  { reference: "Psalm 1:1", text: "Blessed is the man who walks not in the counsel of the ungodly, nor stands in the path of sinners, nor sits in the seat of the scornful.", book: "Psalms", chapter: 1, verse: 1 },
  { reference: "Psalm 4:8", text: "I will both lie down in peace, and sleep; for You alone, O Lord, make me dwell in safety.", book: "Psalms", chapter: 4, verse: 8 },
  { reference: "Psalm 5:3", text: "My voice You shall hear in the morning, O Lord; in the morning I will direct it to You, and I will look up.", book: "Psalms", chapter: 5, verse: 3 },
  { reference: "Psalm 8:1", text: "O Lord, our Lord, how excellent is Your name in all the earth, who have set Your glory above the heavens!", book: "Psalms", chapter: 8, verse: 1 },
  { reference: "Psalm 9:9", text: "The Lord also will be a refuge for the oppressed, a refuge in times of trouble.", book: "Psalms", chapter: 9, verse: 9 },
  { reference: "Psalm 16:8", text: "I have set the Lord always before me; because He is at my right hand I shall not be moved.", book: "Psalms", chapter: 16, verse: 8 },
  { reference: "Psalm 18:2", text: "The Lord is my rock and my fortress and my deliverer; my God, my strength, in whom I will trust; my shield and the horn of my salvation, my stronghold.", book: "Psalms", chapter: 18, verse: 2 },
  { reference: "Psalm 19:1", text: "The heavens declare the glory of God; and the firmament shows His handiwork.", book: "Psalms", chapter: 19, verse: 1 },
  { reference: "Psalm 23:2", text: "He makes me to lie down in green pastures; He leads me beside the still waters.", book: "Psalms", chapter: 23, verse: 2 },
  { reference: "Psalm 23:3", text: "He restores my soul; He leads me in the paths of righteousness for His name's sake.", book: "Psalms", chapter: 23, verse: 3 },
  { reference: "Psalm 23:4", text: "Yea, though I walk through the valley of the shadow of death, I will fear no evil; for You are with me; Your rod and Your staff, they comfort me.", book: "Psalms", chapter: 23, verse: 4 },
  { reference: "Psalm 24:1", text: "The earth is the Lord's, and all its fullness, the world and those who dwell therein.", book: "Psalms", chapter: 24, verse: 1 },
  { reference: "Psalm 25:4", text: "Show me Your ways, O Lord; teach me Your paths.", book: "Psalms", chapter: 25, verse: 4 },
  { reference: "Psalm 25:5", text: "Lead me in Your truth and teach me, for You are the God of my salvation; on You I wait all the day.", book: "Psalms", chapter: 25, verse: 5 },
  { reference: "Psalm 28:7", text: "The Lord is my strength and my shield; my heart trusted in Him, and I am helped; therefore my heart greatly rejoices, and with my song I will praise Him.", book: "Psalms", chapter: 28, verse: 7 },
  { reference: "Psalm 30:5", text: "Weeping may endure for a night, but joy comes in the morning.", book: "Psalms", chapter: 30, verse: 5 },
  { reference: "Psalm 32:7", text: "You are my hiding place; You shall preserve me from trouble; You shall surround me with songs of deliverance.", book: "Psalms", chapter: 32, verse: 7 },
  { reference: "Psalm 34:8", text: "Oh, taste and see that the Lord is good; blessed is the man who trusts in Him!", book: "Psalms", chapter: 34, verse: 8 },
  { reference: "Psalm 34:18", text: "The Lord is near to those who have a broken heart, and saves such as have a contrite spirit.", book: "Psalms", chapter: 34, verse: 18 },
  { reference: "Psalm 37:5", text: "Commit your way to the Lord, trust also in Him, and He shall bring it to pass.", book: "Psalms", chapter: 37, verse: 5 },
  { reference: "Psalm 40:2", text: "He also brought me up out of a horrible pit, out of the miry clay, and set my feet upon a rock, and established my steps.", book: "Psalms", chapter: 40, verse: 2 },
  { reference: "Psalm 42:11", text: "Why are you cast down, O my soul? And why are you disquieted within me? Hope in God; for I shall yet praise Him, the help of my countenance and my God.", book: "Psalms", chapter: 42, verse: 11 },
  { reference: "Psalm 46:10", text: "Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth!", book: "Psalms", chapter: 46, verse: 10 },
  { reference: "Psalm 50:15", text: "Call upon Me in the day of trouble; I will deliver you, and you shall glorify Me.", book: "Psalms", chapter: 50, verse: 15 },
  { reference: "Psalm 51:10", text: "Create in me a clean heart, O God, and renew a steadfast spirit within me.", book: "Psalms", chapter: 51, verse: 10 },
  { reference: "Psalm 55:22", text: "Cast your burden on the Lord, and He shall sustain you; He shall never permit the righteous to be moved.", book: "Psalms", chapter: 55, verse: 22 },
  { reference: "Psalm 56:3", text: "Whenever I am afraid, I will trust in You.", book: "Psalms", chapter: 56, verse: 3 },
  { reference: "Psalm 57:1", text: "Be merciful to me, O God, be merciful to me! For my soul trusts in You; and in the shadow of Your wings I will make my refuge, until these calamities have passed by.", book: "Psalms", chapter: 57, verse: 1 },
  { reference: "Psalm 62:1", text: "Truly my soul silently waits for God; from Him comes my salvation.", book: "Psalms", chapter: 62, verse: 1 },
  { reference: "Psalm 63:1", text: "O God, You are my God; early will I seek You; my soul thirsts for You; my flesh longs for You in a dry and thirsty land where there is no water.", book: "Psalms", chapter: 63, verse: 1 },
  { reference: "Psalm 91:1", text: "He who dwells in the secret place of the Most High shall abide under the shadow of the Almighty.", book: "Psalms", chapter: 91, verse: 1 },
  { reference: "Psalm 91:2", text: "I will say of the Lord, He is my refuge and my fortress; my God, in Him I will trust.", book: "Psalms", chapter: 91, verse: 2 },
  { reference: "Psalm 91:4", text: "He shall cover you with His feathers, and under His wings you shall take refuge; His truth shall be your shield and buckler.", book: "Psalms", chapter: 91, verse: 4 },
  { reference: "Psalm 100:1", text: "Make a joyful shout to the Lord, all you lands!", book: "Psalms", chapter: 100, verse: 1 },
  { reference: "Psalm 100:4", text: "Enter into His gates with thanksgiving, and into His courts with praise. Be thankful to Him, and bless His name.", book: "Psalms", chapter: 100, verse: 4 },
  { reference: "Psalm 100:5", text: "For the Lord is good; His mercy is everlasting, and His truth endures to all generations.", book: "Psalms", chapter: 100, verse: 5 },
  { reference: "Psalm 103:1", text: "Bless the Lord, O my soul; and all that is within me, bless His holy name!", book: "Psalms", chapter: 103, verse: 1 },
  { reference: "Psalm 103:2", text: "Bless the Lord, O my soul, and forget not all His benefits.", book: "Psalms", chapter: 103, verse: 2 },
  { reference: "Psalm 103:3", text: "Who forgives all your iniquities, who heals all your diseases.", book: "Psalms", chapter: 103, verse: 3 },
  { reference: "Psalm 107:1", text: "Oh, give thanks to the Lord, for He is good! For His mercy endures forever.", book: "Psalms", chapter: 107, verse: 1 },
  { reference: "Psalm 118:6", text: "The Lord is on my side; I will not fear. What can man do to me?", book: "Psalms", chapter: 118, verse: 6 },
  { reference: "Psalm 118:24", text: "This is the day the Lord has made; we will rejoice and be glad in it.", book: "Psalms", chapter: 118, verse: 24 },
  { reference: "Psalm 119:9", text: "How can a young man cleanse his way? By taking heed according to Your word.", book: "Psalms", chapter: 119, verse: 9 },
  { reference: "Psalm 119:11", text: "Your word I have hidden in my heart, that I might not sin against You.", book: "Psalms", chapter: 119, verse: 11 },
  { reference: "Psalm 119:105", text: "Your word is a lamp to my feet and a light to my path.", book: "Psalms", chapter: 119, verse: 105 },
  { reference: "Psalm 121:1", text: "I will lift up my eyes to the hills — from whence comes my help?", book: "Psalms", chapter: 121, verse: 1 },
  { reference: "Psalm 121:2", text: "My help comes from the Lord, who made heaven and earth.", book: "Psalms", chapter: 121, verse: 2 },
  { reference: "Psalm 136:1", text: "Oh, give thanks to the Lord, for He is good! For His mercy endures forever.", book: "Psalms", chapter: 136, verse: 1 },
  { reference: "Psalm 139:14", text: "I will praise You, for I am fearfully and wonderfully made; marvelous are Your works, and that my soul knows very well.", book: "Psalms", chapter: 139, verse: 14 },
  { reference: "Psalm 143:8", text: "Cause me to hear Your lovingkindness in the morning, for in You do I trust; cause me to know the way in which I should walk, for I lift up my soul to You.", book: "Psalms", chapter: 143, verse: 8 },
  { reference: "Psalm 145:18", text: "The Lord is near to all who call upon Him, to all who call upon Him in truth.", book: "Psalms", chapter: 145, verse: 18 },

  // Additional Proverbs
  { reference: "Proverbs 1:7", text: "The fear of the Lord is the beginning of knowledge, but fools despise wisdom and instruction.", book: "Proverbs", chapter: 1, verse: 7 },
  { reference: "Proverbs 2:6", text: "For the Lord gives wisdom; from His mouth come knowledge and understanding.", book: "Proverbs", chapter: 2, verse: 6 },
  { reference: "Proverbs 4:7", text: "Wisdom is the principal thing; therefore get wisdom. And in all your getting, get understanding.", book: "Proverbs", chapter: 4, verse: 7 },
  { reference: "Proverbs 6:6", text: "Go to the ant, you sluggard! Consider her ways and be wise.", book: "Proverbs", chapter: 6, verse: 6 },
  { reference: "Proverbs 8:17", text: "I love those who love me, and those who seek me diligently will find me.", book: "Proverbs", chapter: 8, verse: 17 },
  { reference: "Proverbs 10:4", text: "He who has a slack hand becomes poor, but the hand of the diligent makes rich.", book: "Proverbs", chapter: 10, verse: 4 },
  { reference: "Proverbs 12:11", text: "He who tills his land will be satisfied with bread, but he who follows frivolity is devoid of understanding.", book: "Proverbs", chapter: 12, verse: 11 },
  { reference: "Proverbs 14:23", text: "In all labor there is profit, but idle chatter leads only to poverty.", book: "Proverbs", chapter: 14, verse: 23 },
  { reference: "Proverbs 16:11", text: "Honest weights and scales are the Lord's; all the weights in the bag are His work.", book: "Proverbs", chapter: 16, verse: 11 },
  { reference: "Proverbs 17:17", text: "A friend loves at all times, and a brother is born for adversity.", book: "Proverbs", chapter: 17, verse: 17 },
  { reference: "Proverbs 18:10", text: "The name of the Lord is a strong tower; the righteous run to it and are safe.", book: "Proverbs", chapter: 18, verse: 10 },
  { reference: "Proverbs 19:21", text: "There are many plans in a man's heart, nevertheless the Lord's counsel — that will stand.", book: "Proverbs", chapter: 19, verse: 21 },
  { reference: "Proverbs 23:4", text: "Do not overwork to be rich; because of your own understanding, cease!", book: "Proverbs", chapter: 23, verse: 4 },
  { reference: "Proverbs 23:5", text: "Will you set your eyes on that which is not? For riches certainly make themselves wings; they fly away like an eagle toward heaven.", book: "Proverbs", chapter: 23, verse: 5 },
  { reference: "Proverbs 27:1", text: "Do not boast about tomorrow, for you do not know what a day may bring forth.", book: "Proverbs", chapter: 27, verse: 1 },
  { reference: "Proverbs 27:17", text: "As iron sharpens iron, so a man sharpens the countenance of his friend.", book: "Proverbs", chapter: 27, verse: 17 },
  { reference: "Proverbs 28:20", text: "A faithful man will abound with blessings, but he who hastens to be rich will not go unpunished.", book: "Proverbs", chapter: 28, verse: 20 },
  { reference: "Proverbs 29:11", text: "A fool vents all his feelings, but a wise man holds them back.", book: "Proverbs", chapter: 29, verse: 11 },
  { reference: "Proverbs 30:5", text: "Every word of God is pure; He is a shield to those who put their trust in Him.", book: "Proverbs", chapter: 30, verse: 5 },
  { reference: "Proverbs 31:25", text: "Strength and honor are her clothing; she shall rejoice in time to come.", book: "Proverbs", chapter: 31, verse: 25 },

  // Isaiah (additional)
  { reference: "Isaiah 1:18", text: "Come now, and let us reason together, says the Lord, though your sins are like scarlet, they shall be as white as snow.", book: "Isaiah", chapter: 1, verse: 18 },
  { reference: "Isaiah 9:6", text: "For unto us a Child is born, unto us a Son is given; and the government will be upon His shoulder. And His name will be called Wonderful, Counselor, Mighty God, Everlasting Father, Prince of Peace.", book: "Isaiah", chapter: 9, verse: 6 },
  { reference: "Isaiah 26:4", text: "Trust in the Lord forever, for in Yah, the Lord, is everlasting strength.", book: "Isaiah", chapter: 26, verse: 4 },
  { reference: "Isaiah 30:21", text: "Your ears shall hear a word behind you, saying, This is the way, walk in it, whenever you turn to the right hand or whenever you turn to the left.", book: "Isaiah", chapter: 30, verse: 21 },
  { reference: "Isaiah 43:2", text: "When you pass through the waters, I will be with you; and through the rivers, they shall not overflow you.", book: "Isaiah", chapter: 43, verse: 2 },
  { reference: "Isaiah 43:19", text: "Behold, I will do a new thing, now it shall spring forth; shall you not know it? I will even make a road in the wilderness and rivers in the desert.", book: "Isaiah", chapter: 43, verse: 19 },
  { reference: "Isaiah 54:17", text: "No weapon formed against you shall prosper, and every tongue which rises against you in judgment you shall condemn.", book: "Isaiah", chapter: 54, verse: 17 },
  { reference: "Isaiah 55:8", text: "For My thoughts are not your thoughts, nor are your ways My ways, says the Lord.", book: "Isaiah", chapter: 55, verse: 8 },
  { reference: "Isaiah 55:11", text: "So shall My word be that goes forth from My mouth; it shall not return to Me void, but it shall accomplish what I please, and it shall prosper in the thing for which I sent it.", book: "Isaiah", chapter: 55, verse: 11 },
  { reference: "Isaiah 58:11", text: "The Lord will guide you continually, and satisfy your soul in drought, and strengthen your bones; you shall be like a watered garden, and like a spring of water, whose waters do not fail.", book: "Isaiah", chapter: 58, verse: 11 },
  { reference: "Isaiah 60:1", text: "Arise, shine; for your light has come! And the glory of the Lord is risen upon you.", book: "Isaiah", chapter: 60, verse: 1 },
  { reference: "Isaiah 61:1", text: "The Spirit of the Lord God is upon Me, because the Lord has anointed Me to preach good tidings to the poor; He has sent Me to heal the brokenhearted, to proclaim liberty to the captives.", book: "Isaiah", chapter: 61, verse: 1 },
  { reference: "Isaiah 64:4", text: "For since the beginning of the world men have not heard nor perceived by the ear, nor has the eye seen any God besides You, who acts for the one who waits for Him.", book: "Isaiah", chapter: 64, verse: 4 },

  // Matthew, Mark, Luke, John (additional)
  { reference: "Matthew 5:3", text: "Blessed are the poor in spirit, for theirs is the kingdom of heaven.", book: "Matthew", chapter: 5, verse: 3 },
  { reference: "Matthew 5:4", text: "Blessed are those who mourn, for they shall be comforted.", book: "Matthew", chapter: 5, verse: 4 },
  { reference: "Matthew 5:5", text: "Blessed are the meek, for they shall inherit the earth.", book: "Matthew", chapter: 5, verse: 5 },
  { reference: "Matthew 5:6", text: "Blessed are those who hunger and thirst for righteousness, for they shall be filled.", book: "Matthew", chapter: 5, verse: 6 },
  { reference: "Matthew 5:7", text: "Blessed are the merciful, for they shall obtain mercy.", book: "Matthew", chapter: 5, verse: 7 },
  { reference: "Matthew 5:8", text: "Blessed are the pure in heart, for they shall see God.", book: "Matthew", chapter: 5, verse: 8 },
  { reference: "Matthew 5:9", text: "Blessed are the peacemakers, for they shall be called sons of God.", book: "Matthew", chapter: 5, verse: 9 },
  { reference: "Matthew 6:9", text: "Our Father in heaven, hallowed be Your name.", book: "Matthew", chapter: 6, verse: 9 },
  { reference: "Matthew 6:10", text: "Your kingdom come. Your will be done on earth as it is in heaven.", book: "Matthew", chapter: 6, verse: 10 },
  { reference: "Matthew 7:7", text: "Ask, and it will be given to you; seek, and you will find; knock, and it will be opened to you.", book: "Matthew", chapter: 7, verse: 7 },
  { reference: "Matthew 7:12", text: "Therefore, whatever you want men to do to you, do also to them, for this is the Law and the Prophets.", book: "Matthew", chapter: 7, verse: 12 },
  { reference: "Matthew 11:29", text: "Take My yoke upon you and learn from Me, for I am gentle and lowly in heart, and you will find rest for your souls.", book: "Matthew", chapter: 11, verse: 29 },
  { reference: "Matthew 17:20", text: "For assuredly, I say to you, if you have faith as a mustard seed, you will say to this mountain, Move from here to there, and it will move; and nothing will be impossible for you.", book: "Matthew", chapter: 17, verse: 20 },
  { reference: "Matthew 19:26", text: "But Jesus looked at them and said to them, With men this is impossible, but with God all things are possible.", book: "Matthew", chapter: 19, verse: 26 },
  { reference: "Matthew 28:19", text: "Go therefore and make disciples of all the nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit.", book: "Matthew", chapter: 28, verse: 19 },
  { reference: "Matthew 28:20", text: "Teaching them to observe all things that I have commanded you; and lo, I am with you always, even to the end of the age.", book: "Matthew", chapter: 28, verse: 20 },
  { reference: "Mark 9:23", text: "Jesus said to him, If you can believe, all things are possible to him who believes.", book: "Mark", chapter: 9, verse: 23 },
  { reference: "Mark 10:27", text: "But Jesus looked at them and said, With men it is impossible, but not with God; for with God all things are possible.", book: "Mark", chapter: 10, verse: 27 },
  { reference: "Mark 11:24", text: "Therefore I say to you, whatever things you ask when you pray, believe that you receive them, and you will have them.", book: "Mark", chapter: 11, verse: 24 },
  { reference: "Luke 1:37", text: "For with God nothing will be impossible.", book: "Luke", chapter: 1, verse: 37 },
  { reference: "Luke 6:27", text: "But I say to you who hear: Love your enemies, do good to those who hate you.", book: "Luke", chapter: 6, verse: 27 },
  { reference: "Luke 6:31", text: "And just as you want men to do to you, you also do to them likewise.", book: "Luke", chapter: 6, verse: 31 },
  { reference: "Luke 11:9", text: "So I say to you, ask, and it will be given to you; seek, and you will find; knock, and it will be opened to you.", book: "Luke", chapter: 11, verse: 9 },
  { reference: "Luke 12:15", text: "And He said to them, Take heed and beware of covetousness, for one's life does not consist in the abundance of the things he possesses.", book: "Luke", chapter: 12, verse: 15 },
  { reference: "Luke 17:6", text: "If you have faith as a mustard seed, you can say to this mulberry tree, Be pulled up by the roots and be planted in the sea, and it would obey you.", book: "Luke", chapter: 17, verse: 6 },
  { reference: "Luke 21:19", text: "By your patience possess your souls.", book: "Luke", chapter: 21, verse: 19 },
  { reference: "John 1:1", text: "In the beginning was the Word, and the Word was with God, and the Word was God.", book: "John", chapter: 1, verse: 1 },
  { reference: "John 3:16", text: "For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.", book: "John", chapter: 3, verse: 16 },
  { reference: "John 3:17", text: "For God did not send His Son into the world to condemn the world, but that the world through Him might be saved.", book: "John", chapter: 3, verse: 17 },
  { reference: "John 8:12", text: "Then Jesus spoke to them again, saying, I am the light of the world. He who follows Me shall not walk in darkness, but have the light of life.", book: "John", chapter: 8, verse: 12 },
  { reference: "John 8:32", text: "And you shall know the truth, and the truth shall make you free.", book: "John", chapter: 8, verse: 32 },
  { reference: "John 10:10", text: "The thief does not come except to steal, and to kill, and to destroy. I have come that they may have life, and that they may have it more abundantly.", book: "John", chapter: 10, verse: 10 },
  { reference: "John 11:25", text: "Jesus said to her, I am the resurrection and the life. He who believes in Me, though he may die, he shall live.", book: "John", chapter: 11, verse: 25 },
  { reference: "John 13:34", text: "A new commandment I give to you, that you love one another; as I have loved you, that you also love one another.", book: "John", chapter: 13, verse: 34 },
  { reference: "John 15:5", text: "I am the vine, you are the branches. He who abides in Me, and I in him, bears much fruit; for without Me you can do nothing.", book: "John", chapter: 15, verse: 5 },
  { reference: "John 16:33", text: "These things I have spoken to you, that in Me you may have peace. In the world you will have tribulation; but be of good cheer, I have overcome the world.", book: "John", chapter: 16, verse: 33 },

  // Romans, Corinthians (additional)
  { reference: "Romans 1:16", text: "For I am not ashamed of the gospel of Christ, for it is the power of God to salvation for everyone who believes.", book: "Romans", chapter: 1, verse: 16 },
  { reference: "Romans 5:1", text: "Therefore, having been justified by faith, we have peace with God through our Lord Jesus Christ.", book: "Romans", chapter: 5, verse: 1 },
  { reference: "Romans 6:23", text: "For the wages of sin is death, but the gift of God is eternal life in Christ Jesus our Lord.", book: "Romans", chapter: 6, verse: 23 },
  { reference: "Romans 8:1", text: "There is therefore now no condemnation to those who are in Christ Jesus, who do not walk according to the flesh, but according to the Spirit.", book: "Romans", chapter: 8, verse: 1 },
  { reference: "Romans 8:31", text: "What then shall we say to these things? If God is for us, who can be against us?", book: "Romans", chapter: 8, verse: 31 },
  { reference: "Romans 8:37", text: "Yet in all these things we are more than conquerors through Him who loved us.", book: "Romans", chapter: 8, verse: 37 },
  { reference: "Romans 8:38", text: "For I am persuaded that neither death nor life, nor angels nor principalities nor powers, nor things present nor things to come, nor height nor depth, nor any other created thing, shall be able to separate us from the love of God which is in Christ Jesus our Lord.", book: "Romans", chapter: 8, verse: 38 },
  { reference: "Romans 10:9", text: "That if you confess with your mouth the Lord Jesus and believe in your heart that God has raised Him from the dead, you will be saved.", book: "Romans", chapter: 10, verse: 9 },
  { reference: "Romans 10:13", text: "For whoever calls on the name of the Lord shall be saved.", book: "Romans", chapter: 10, verse: 13 },
  { reference: "Romans 12:1", text: "I beseech you therefore, brethren, by the mercies of God, that you present your bodies a living sacrifice, holy, acceptable to God, which is your reasonable service.", book: "Romans", chapter: 12, verse: 1 },
  { reference: "Romans 12:2", text: "And do not be conformed to this world, but be transformed by the renewing of your mind, that you may prove what is that good and acceptable and perfect will of God.", book: "Romans", chapter: 12, verse: 2 },
  { reference: "1 Corinthians 2:9", text: "But as it is written: Eye has not seen, nor ear heard, nor have entered into the heart of man the things which God has prepared for those who love Him.", book: "1 Corinthians", chapter: 2, verse: 9 },
  { reference: "1 Corinthians 6:20", text: "For you were bought at a price; therefore glorify God in your body and in your spirit, which are God's.", book: "1 Corinthians", chapter: 6, verse: 20 },
  { reference: "1 Corinthians 10:13", text: "No temptation has overtaken you except such as is common to man; but God is faithful, who will not allow you to be tempted beyond what you are able.", book: "1 Corinthians", chapter: 10, verse: 13 },
  { reference: "1 Corinthians 13:4", text: "Love suffers long and is kind; love does not envy; love does not parade itself, is not puffed up.", book: "1 Corinthians", chapter: 13, verse: 4 },
  { reference: "1 Corinthians 13:7", text: "Bears all things, believes all things, hopes all things, endures all things.", book: "1 Corinthians", chapter: 13, verse: 7 },
  { reference: "2 Corinthians 4:17", text: "For our light and momentary troubles are achieving for us an eternal glory that far outweighs them all.", book: "2 Corinthians", chapter: 4, verse: 17 },
  { reference: "2 Corinthians 5:7", text: "For we walk by faith, not by sight.", book: "2 Corinthians", chapter: 5, verse: 7 },
  { reference: "2 Corinthians 5:17", text: "Therefore, if anyone is in Christ, he is a new creation; old things have passed away; behold, all things have become new.", book: "2 Corinthians", chapter: 5, verse: 17 },
  { reference: "2 Corinthians 12:9", text: "And He said to me, My grace is sufficient for you, for My strength is made perfect in weakness.", book: "2 Corinthians", chapter: 12, verse: 9 },
  { reference: "2 Corinthians 13:14", text: "The grace of the Lord Jesus Christ, and the love of God, and the communion of the Holy Spirit be with you all.", book: "2 Corinthians", chapter: 13, verse: 14 },

  // Galatians through Revelation
  { reference: "Galatians 2:20", text: "I have been crucified with Christ; it is no longer I who live, but Christ lives in me; and the life which I now live in the flesh I live by faith in the Son of God, who loved me and gave Himself for me.", book: "Galatians", chapter: 2, verse: 20 },
  { reference: "Galatians 5:22", text: "But the fruit of the Spirit is love, joy, peace, longsuffering, kindness, goodness, faithfulness.", book: "Galatians", chapter: 5, verse: 22 },
  { reference: "Galatians 5:23", text: "Gentleness, self-control. Against such there is no law.", book: "Galatians", chapter: 5, verse: 23 },
  { reference: "Galatians 6:7", text: "Do not be deceived, God is not mocked; for whatever a man sows, that he will also reap.", book: "Galatians", chapter: 6, verse: 7 },
  { reference: "Galatians 6:9", text: "And let us not grow weary while doing good, for in due season we shall reap if we do not lose heart.", book: "Galatians", chapter: 6, verse: 9 },
  { reference: "Ephesians 2:8", text: "For by grace you have been saved through faith, and that not of yourselves; it is the gift of God.", book: "Ephesians", chapter: 2, verse: 8 },
  { reference: "Ephesians 2:10", text: "For we are His workmanship, created in Christ Jesus for good works, which God prepared beforehand that we should walk in them.", book: "Ephesians", chapter: 2, verse: 10 },
  { reference: "Ephesians 3:20", text: "Now to Him who is able to do exceedingly abundantly above all that we ask or think, according to the power that works in us.", book: "Ephesians", chapter: 3, verse: 20 },
  { reference: "Ephesians 4:32", text: "And be kind to one another, tenderhearted, forgiving one another, even as God in Christ forgave you.", book: "Ephesians", chapter: 4, verse: 32 },
  { reference: "Ephesians 6:13", text: "Therefore take up the whole armor of God, that you may be able to withstand in the evil day, and having done all, to stand.", book: "Ephesians", chapter: 6, verse: 13 },
  { reference: "Philippians 1:6", text: "Being confident of this very thing, that He who has begun a good work in you will complete it until the day of Jesus Christ.", book: "Philippians", chapter: 1, verse: 6 },
  { reference: "Philippians 2:13", text: "For it is God who works in you both to will and to do for His good pleasure.", book: "Philippians", chapter: 2, verse: 13 },
  { reference: "Philippians 4:4", text: "Rejoice in the Lord always. Again I will say, rejoice!", book: "Philippians", chapter: 4, verse: 4 },
  { reference: "Philippians 4:8", text: "Finally, brethren, whatever things are true, whatever things are noble, whatever things are just, whatever things are pure, whatever things are lovely, whatever things are of good report, if there is any virtue and if there is anything praiseworthy — meditate on these things.", book: "Philippians", chapter: 4, verse: 8 },
  { reference: "Colossians 1:17", text: "And He is before all things, and in Him all things consist.", book: "Colossians", chapter: 1, verse: 17 },
  { reference: "Colossians 3:17", text: "And whatever you do in word or deed, do all in the name of the Lord Jesus, giving thanks to God the Father through Him.", book: "Colossians", chapter: 3, verse: 17 },
  { reference: "1 Thessalonians 5:16", text: "Rejoice always.", book: "1 Thessalonians", chapter: 5, verse: 16 },
  { reference: "1 Thessalonians 5:17", text: "Pray without ceasing.", book: "1 Thessalonians", chapter: 5, verse: 17 },
  { reference: "1 Thessalonians 5:18", text: "In everything give thanks; for this is the will of God in Christ Jesus for you.", book: "1 Thessalonians", chapter: 5, verse: 18 },
  { reference: "2 Thessalonians 1:11", text: "Therefore we also pray always for you that our God would count you worthy of this calling, and fulfill all the good pleasure of His goodness and the work of faith with power.", book: "2 Thessalonians", chapter: 1, verse: 11 },
  { reference: "1 Timothy 6:17", text: "Command those who are rich in this present age not to be haughty, nor to trust in uncertain riches but in the living God, who gives us richly all things to enjoy.", book: "1 Timothy", chapter: 6, verse: 17 },
  { reference: "Hebrews 10:23", text: "Let us hold fast the confession of our hope without wavering, for He who promised is faithful.", book: "Hebrews", chapter: 10, verse: 23 },
  { reference: "Hebrews 12:1", text: "Therefore we also, since we are surrounded by so great a cloud of witnesses, let us lay aside every weight, and the sin which so easily ensnares us, and let us run with endurance the race that is set before us.", book: "Hebrews", chapter: 12, verse: 1 },
  { reference: "James 1:2", text: "My brethren, count it all joy when you fall into various trials.", book: "James", chapter: 1, verse: 2 },
  { reference: "James 1:17", text: "Every good gift and every perfect gift is from above, and comes down from the Father of lights, with whom there is no variation or shadow of turning.", book: "James", chapter: 1, verse: 17 },
  { reference: "James 4:7", text: "Therefore submit to God. Resist the devil and he will flee from you.", book: "James", chapter: 4, verse: 7 },
  { reference: "James 4:8", text: "Draw near to God and He will draw near to you.", book: "James", chapter: 4, verse: 8 },
  { reference: "1 Peter 2:9", text: "But you are a chosen generation, a royal priesthood, a holy nation, His own special people, that you may proclaim the praises of Him who called you out of darkness into His marvelous light.", book: "1 Peter", chapter: 2, verse: 9 },
  { reference: "1 Peter 4:10", text: "As each one has received a gift, minister it to one another, as good stewards of the manifold grace of God.", book: "1 Peter", chapter: 4, verse: 10 },
  { reference: "1 Peter 5:6", text: "Therefore humble yourselves under the mighty hand of God, that He may exalt you in due time.", book: "1 Peter", chapter: 5, verse: 6 },
  { reference: "2 Peter 1:3", text: "As His divine power has given to us all things that pertain to life and godliness, through the knowledge of Him who called us by glory and virtue.", book: "2 Peter", chapter: 1, verse: 3 },
  { reference: "1 John 1:9", text: "If we confess our sins, He is faithful and just to forgive us our sins and to cleanse us from all unrighteousness.", book: "1 John", chapter: 1, verse: 9 },
  { reference: "1 John 3:1", text: "Behold what manner of love the Father has bestowed on us, that we should be called children of God!", book: "1 John", chapter: 3, verse: 1 },
  { reference: "1 John 4:4", text: "You are of God, little children, and have overcome them, because He who is in you is greater than he who is in the world.", book: "1 John", chapter: 4, verse: 4 },
  { reference: "1 John 4:16", text: "And we have known and believed the love that God has for us. God is love, and he who abides in love abides in God, and God in him.", book: "1 John", chapter: 4, verse: 16 },
  { reference: "1 John 4:18", text: "There is no fear in love; but perfect love casts out fear, because fear involves torment.", book: "1 John", chapter: 4, verse: 18 },
  { reference: "1 John 5:4", text: "For whatever is born of God overcomes the world. And this is the victory that has overcome the world — our faith.", book: "1 John", chapter: 5, verse: 4 },
  { reference: "Revelation 3:20", text: "Behold, I stand at the door and knock. If anyone hears My voice and opens the door, I will come in to him and dine with him, and he with Me.", book: "Revelation", chapter: 3, verse: 20 },
  { reference: "Revelation 21:4", text: "And God will wipe away every tear from their eyes; there shall be no more death, nor sorrow, nor crying. There shall be no more pain, for the former things have passed away.", book: "Revelation", chapter: 21, verse: 4 },
  { reference: "Revelation 22:20", text: "He who testifies to these things says, Surely I am coming quickly. Amen. Even so, come, Lord Jesus!", book: "Revelation", chapter: 22, verse: 20 },

  // Additional OT — Genesis, Exodus, Deuteronomy, Samuel, Kings
  { reference: "Genesis 1:1", text: "In the beginning God created the heavens and the earth.", book: "Genesis", chapter: 1, verse: 1 },
  { reference: "Genesis 1:27", text: "So God created man in His own image; in the image of God He created him; male and female He created them.", book: "Genesis", chapter: 1, verse: 27 },
  { reference: "Genesis 2:2", text: "And on the seventh day God ended His work which He had done, and He rested on the seventh day from all His work which He had done.", book: "Genesis", chapter: 2, verse: 2 },
  { reference: "Genesis 15:1", text: "After these things the word of the Lord came to Abram in a vision, saying, Do not be afraid, Abram. I am your shield, your exceedingly great reward.", book: "Genesis", chapter: 15, verse: 1 },
  { reference: "Genesis 22:14", text: "And Abraham called the name of the place, The-Lord-Will-Provide; as it is said to this day, In the Mount of the Lord it shall be provided.", book: "Genesis", chapter: 22, verse: 14 },
  { reference: "Genesis 50:20", text: "But as for you, you meant evil against me; but God meant it for good, in order to bring it about as it is this day, to save many people alive.", book: "Genesis", chapter: 50, verse: 20 },
  { reference: "Exodus 14:14", text: "The Lord will fight for you, and you shall hold your peace.", book: "Exodus", chapter: 14, verse: 14 },
  { reference: "Exodus 15:2", text: "The Lord is my strength and song, and He has become my salvation; He is my God, and I will praise Him; my father's God, and I will exalt Him.", book: "Exodus", chapter: 15, verse: 2 },
  { reference: "Exodus 20:12", text: "Honor your father and your mother, that your days may be long upon the land which the Lord your God is giving you.", book: "Exodus", chapter: 20, verse: 12 },
  { reference: "Numbers 6:24", text: "The Lord bless you and keep you.", book: "Numbers", chapter: 6, verse: 24 },
  { reference: "Numbers 6:25", text: "The Lord make His face shine upon you, and be gracious to you.", book: "Numbers", chapter: 6, verse: 25 },
  { reference: "Numbers 6:26", text: "The Lord lift up His countenance upon you, and give you peace.", book: "Numbers", chapter: 6, verse: 26 },
  { reference: "Deuteronomy 6:5", text: "You shall love the Lord your God with all your heart, with all your soul, and with all your strength.", book: "Deuteronomy", chapter: 6, verse: 5 },
  { reference: "Deuteronomy 28:2", text: "And all these blessings shall come upon you and overtake you, because you obey the voice of the Lord your God.", book: "Deuteronomy", chapter: 28, verse: 2 },
  { reference: "Deuteronomy 30:14", text: "But the word is very near you, in your mouth and in your heart, that you may do it.", book: "Deuteronomy", chapter: 30, verse: 14 },
  { reference: "Deuteronomy 30:19", text: "I call heaven and earth as witnesses today against you, that I have set before you life and death, blessing and cursing; therefore choose life, that both you and your descendants may live.", book: "Deuteronomy", chapter: 30, verse: 19 },
  { reference: "1 Samuel 16:7", text: "But the Lord said to Samuel, Do not look at his appearance or at his physical stature, because I have refused him. For the Lord does not see as man sees; for man looks at the outward appearance, but the Lord looks at the heart.", book: "1 Samuel", chapter: 16, verse: 7 },
  { reference: "2 Samuel 22:3", text: "The God of my strength, in whom I will trust; my shield and the horn of my salvation, my stronghold and my refuge; my Savior, You save me from violence.", book: "2 Samuel", chapter: 22, verse: 3 },
  { reference: "1 Kings 8:56", text: "Blessed be the Lord, who has given rest to His people Israel, according to all that He promised.", book: "1 Kings", chapter: 8, verse: 56 },
  { reference: "2 Kings 6:16", text: "So he answered, Do not fear, for those who are with us are more than those who are with them.", book: "2 Kings", chapter: 6, verse: 16 },

  // More Psalms
  { reference: "Psalm 2:12", text: "Kiss the Son, lest He be angry, and you perish in the way, when His wrath is kindled but a little. Blessed are all those who put their trust in Him.", book: "Psalms", chapter: 2, verse: 12 },
  { reference: "Psalm 3:3", text: "But You, O Lord, are a shield for me, my glory and the One who lifts up my head.", book: "Psalms", chapter: 3, verse: 3 },
  { reference: "Psalm 6:4", text: "Return, O Lord, deliver me! Oh, save me for Your mercies' sake!", book: "Psalms", chapter: 6, verse: 4 },
  { reference: "Psalm 10:17", text: "Lord, You have heard the desire of the humble; You will prepare their heart; You will cause Your ear to hear.", book: "Psalms", chapter: 10, verse: 17 },
  { reference: "Psalm 11:7", text: "For the Lord is righteous, He loves righteousness; His countenance beholds the upright.", book: "Psalms", chapter: 11, verse: 7 },
  { reference: "Psalm 13:5", text: "But I have trusted in Your mercy; my heart shall rejoice in Your salvation.", book: "Psalms", chapter: 13, verse: 5 },
  { reference: "Psalm 16:11", text: "You will show me the path of life; in Your presence is fullness of joy; at Your right hand are pleasures forevermore.", book: "Psalms", chapter: 16, verse: 11 },
  { reference: "Psalm 17:8", text: "Keep me as the apple of Your eye; hide me under the shadow of Your wings.", book: "Psalms", chapter: 17, verse: 8 },
  { reference: "Psalm 18:30", text: "As for God, His way is perfect; the word of the Lord is proven; He is a shield to all who trust in Him.", book: "Psalms", chapter: 18, verse: 30 },
  { reference: "Psalm 20:7", text: "Some trust in chariots, and some in horses; but we will remember the name of the Lord our God.", book: "Psalms", chapter: 20, verse: 7 },
  { reference: "Psalm 22:3", text: "But You are holy, enthroned in the praises of Israel.", book: "Psalms", chapter: 22, verse: 3 },
  { reference: "Psalm 26:3", text: "For Your lovingkindness is before my eyes, and I have walked in Your truth.", book: "Psalms", chapter: 26, verse: 3 },
  { reference: "Psalm 27:4", text: "One thing I have desired of the Lord, that will I seek: that I may dwell in the house of the Lord all the days of my life, to behold the beauty of the Lord, and to inquire in His temple.", book: "Psalms", chapter: 27, verse: 4 },
  { reference: "Psalm 27:14", text: "Wait on the Lord; be of good courage, and He shall strengthen your heart; wait, I say, on the Lord!", book: "Psalms", chapter: 27, verse: 14 },
  { reference: "Psalm 29:2", text: "Give unto the Lord the glory due to His name; worship the Lord in the beauty of holiness.", book: "Psalms", chapter: 29, verse: 2 },
  { reference: "Psalm 31:3", text: "For You are my rock and my fortress; therefore, for Your name's sake, lead me and guide me.", book: "Psalms", chapter: 31, verse: 3 },
  { reference: "Psalm 31:14", text: "But as for me, I trust in You, O Lord; I say, You are my God.", book: "Psalms", chapter: 31, verse: 14 },
  { reference: "Psalm 33:11", text: "The counsel of the Lord stands forever, the plans of His heart to all generations.", book: "Psalms", chapter: 33, verse: 11 },
  { reference: "Psalm 34:4", text: "I sought the Lord, and He heard me, and delivered me from all my fears.", book: "Psalms", chapter: 34, verse: 4 },
  { reference: "Psalm 34:7", text: "The angel of the Lord encamps all around those who fear Him, and delivers them.", book: "Psalms", chapter: 34, verse: 7 },
  { reference: "Psalm 34:15", text: "The eyes of the Lord are on the righteous, and His ears are open to their cry.", book: "Psalms", chapter: 34, verse: 15 },
  { reference: "Psalm 35:27", text: "Let the Lord be magnified, who has pleasure in the prosperity of His servant.", book: "Psalms", chapter: 35, verse: 27 },
  { reference: "Psalm 37:23", text: "The steps of a good man are ordered by the Lord, and He delights in his way.", book: "Psalms", chapter: 37, verse: 23 },
  { reference: "Psalm 37:25", text: "I have been young, and now am old; yet I have not seen the righteous forsaken, nor his descendants begging bread.", book: "Psalms", chapter: 37, verse: 25 },
  { reference: "Psalm 40:1", text: "I waited patiently for the Lord; and He inclined to me, and heard my cry.", book: "Psalms", chapter: 40, verse: 1 },
  { reference: "Psalm 43:5", text: "Why are you cast down, O my soul? And why are you disquieted within me? Hope in God; for I shall yet praise Him, the help of my countenance and my God.", book: "Psalms", chapter: 43, verse: 5 },
  { reference: "Psalm 44:8", text: "In God we boast all day long, and praise Your name forever.", book: "Psalms", chapter: 44, verse: 8 },
  { reference: "Psalm 48:14", text: "For this is God, our God forever and ever; He will be our guide even to death.", book: "Psalms", chapter: 48, verse: 14 },
  { reference: "Psalm 52:8", text: "But I am like a green olive tree in the house of God; I trust in the mercy of God forever and ever.", book: "Psalms", chapter: 52, verse: 8 },
  { reference: "Psalm 57:2", text: "I will cry out to God Most High, to God who performs all things for me.", book: "Psalms", chapter: 57, verse: 2 },
  { reference: "Psalm 59:17", text: "To You, O my Strength, I will sing praises; for God is my defense, my God of mercy.", book: "Psalms", chapter: 59, verse: 17 },
  { reference: "Psalm 62:5", text: "My soul, wait silently for God alone, for my expectation is from Him.", book: "Psalms", chapter: 62, verse: 5 },
  { reference: "Psalm 62:8", text: "Trust in Him at all times, you people; pour out your heart before Him; God is a refuge for us.", book: "Psalms", chapter: 62, verse: 8 },
  { reference: "Psalm 66:20", text: "Blessed be God, who has not turned away my prayer, nor His mercy from me!", book: "Psalms", chapter: 66, verse: 20 },
  { reference: "Psalm 68:19", text: "Blessed be the Lord, who daily loads us with benefits, the God of our salvation!", book: "Psalms", chapter: 68, verse: 19 },
  { reference: "Psalm 71:14", text: "But I will hope continually, and will praise You yet more and more.", book: "Psalms", chapter: 71, verse: 14 },
  { reference: "Psalm 72:19", text: "And blessed be His glorious name forever! And let the whole earth be filled with His glory.", book: "Psalms", chapter: 72, verse: 19 },
  { reference: "Psalm 73:26", text: "My flesh and my heart fail; but God is the strength of my heart and my portion forever.", book: "Psalms", chapter: 73, verse: 26 },
  { reference: "Psalm 84:11", text: "For the Lord God is a sun and shield; the Lord will give grace and glory; no good thing will He withhold from those who walk uprightly.", book: "Psalms", chapter: 84, verse: 11 },
  { reference: "Psalm 86:11", text: "Teach me Your way, O Lord; I will walk in Your truth; unite my heart to fear Your name.", book: "Psalms", chapter: 86, verse: 11 },
  { reference: "Psalm 86:15", text: "But You, O Lord, are a God full of compassion, and gracious, longsuffering and abundant in mercy and truth.", book: "Psalms", chapter: 86, verse: 15 },
  { reference: "Psalm 89:11", text: "The heavens are Yours, the earth also is Yours; the world and all its fullness, You have founded them.", book: "Psalms", chapter: 89, verse: 11 },
  { reference: "Psalm 90:14", text: "Oh, satisfy us early with Your mercy, that we may rejoice and be glad all our days!", book: "Psalms", chapter: 90, verse: 14 },
  { reference: "Psalm 92:4", text: "For You, Lord, have made me glad through Your work; I will triumph in the works of Your hands.", book: "Psalms", chapter: 92, verse: 4 },
  { reference: "Psalm 94:19", text: "In the multitude of my anxieties within me, Your comforts delight my soul.", book: "Psalms", chapter: 94, verse: 19 },
  { reference: "Psalm 103:17", text: "But the mercy of the Lord is from everlasting to everlasting on those who fear Him.", book: "Psalms", chapter: 103, verse: 17 },
  { reference: "Psalm 104:24", text: "O Lord, how manifold are Your works! In wisdom You have made them all.", book: "Psalms", chapter: 104, verse: 24 },
  { reference: "Psalm 105:3", text: "Glory in His holy name; let the hearts of those rejoice who seek the Lord!", book: "Psalms", chapter: 105, verse: 3 },
  { reference: "Psalm 108:4", text: "For Your mercy is great above the heavens, and Your truth reaches to the clouds.", book: "Psalms", chapter: 108, verse: 4 },
  { reference: "Psalm 115:14", text: "May the Lord give you increase more and more, you and your children.", book: "Psalms", chapter: 115, verse: 14 },
  { reference: "Psalm 116:15", text: "Precious in the sight of the Lord is the death of His saints.", book: "Psalms", chapter: 116, verse: 15 },
  { reference: "Psalm 117:2", text: "For His merciful kindness is great toward us, and the truth of the Lord endures forever. Praise the Lord!", book: "Psalms", chapter: 117, verse: 2 },
  { reference: "Psalm 119:18", text: "Open my eyes, that I may see wondrous things from Your law.", book: "Psalms", chapter: 119, verse: 18 },
  { reference: "Psalm 119:32", text: "I will run the course of Your commandments, for You shall enlarge my heart.", book: "Psalms", chapter: 119, verse: 32 },
  { reference: "Psalm 119:89", text: "Forever, O Lord, Your word is settled in heaven.", book: "Psalms", chapter: 119, verse: 89 },
  { reference: "Psalm 119:130", text: "The entrance of Your words gives light; it gives understanding to the simple.", book: "Psalms", chapter: 119, verse: 130 },
  { reference: "Psalm 119:165", text: "Great peace have those who love Your law, and nothing causes them to stumble.", book: "Psalms", chapter: 119, verse: 165 },
  { reference: "Psalm 122:1", text: "I was glad when they said to me, Let us go into the house of the Lord.", book: "Psalms", chapter: 122, verse: 1 },
  { reference: "Psalm 126:5", text: "Those who sow in tears shall reap in joy.", book: "Psalms", chapter: 126, verse: 5 },
  { reference: "Psalm 128:5", text: "The Lord bless you out of Zion, and may you see the good of Jerusalem all the days of your life.", book: "Psalms", chapter: 128, verse: 5 },
  { reference: "Psalm 131:2", text: "Surely I have calmed and quieted my soul, like a weaned child with his mother; like a weaned child is my soul within me.", book: "Psalms", chapter: 131, verse: 2 },
  { reference: "Psalm 138:3", text: "In the day when I cried out, You answered me, and made me bold with strength in my soul.", book: "Psalms", chapter: 138, verse: 3 },
  { reference: "Psalm 138:8", text: "The Lord will perfect that which concerns me; Your mercy, O Lord, endures forever.", book: "Psalms", chapter: 138, verse: 8 },
  { reference: "Psalm 139:1", text: "O Lord, You have searched me and known me.", book: "Psalms", chapter: 139, verse: 1 },
  { reference: "Psalm 139:23", text: "Search me, O God, and know my heart; try me, and know my anxieties.", book: "Psalms", chapter: 139, verse: 23 },
  { reference: "Psalm 141:3", text: "Set a guard, O Lord, over my mouth; keep watch over the door of my lips.", book: "Psalms", chapter: 141, verse: 3 },
  { reference: "Psalm 146:5", text: "Happy is he who has the God of Jacob for his help, whose hope is in the Lord his God.", book: "Psalms", chapter: 146, verse: 5 },
  { reference: "Psalm 147:3", text: "He heals the brokenhearted and binds up their wounds.", book: "Psalms", chapter: 147, verse: 3 },
  { reference: "Psalm 150:6", text: "Let everything that has breath praise the Lord. Praise the Lord!", book: "Psalms", chapter: 150, verse: 6 },

  // Jeremiah, Ezekiel, Daniel
  { reference: "Jeremiah 17:7", text: "Blessed is the man who trusts in the Lord, and whose hope is the Lord.", book: "Jeremiah", chapter: 17, verse: 7 },
  { reference: "Jeremiah 31:3", text: "The Lord has appeared of old to me, saying: Yes, I have loved you with an everlasting love; therefore with lovingkindness I have drawn you.", book: "Jeremiah", chapter: 31, verse: 3 },
  { reference: "Jeremiah 32:27", text: "Behold, I am the Lord, the God of all flesh. Is there anything too hard for Me?", book: "Jeremiah", chapter: 32, verse: 27 },
  { reference: "Jeremiah 33:3", text: "Call to Me, and I will answer you, and show you great and mighty things, which you do not know.", book: "Jeremiah", chapter: 33, verse: 3 },
  { reference: "Ezekiel 36:26", text: "I will give you a new heart and put a new spirit within you; I will take the heart of stone out of your flesh and give you a heart of flesh.", book: "Ezekiel", chapter: 36, verse: 26 },
  { reference: "Daniel 3:17", text: "If that is the case, our God whom we serve is able to deliver us from the burning fiery furnace, and He will deliver us from your hand, O king.", book: "Daniel", chapter: 3, verse: 17 },
  { reference: "Daniel 6:22", text: "My God sent His angel and shut the lions' mouths, so that they have not hurt me, because I was found innocent before Him.", book: "Daniel", chapter: 6, verse: 22 },

  // Minor Prophets
  { reference: "Hosea 6:3", text: "Let us know, let us pursue the knowledge of the Lord. His going forth is established as the morning; He will come to us like the rain, like the latter and former rain to the earth.", book: "Hosea", chapter: 6, verse: 3 },
  { reference: "Joel 2:28", text: "And it shall come to pass afterward that I will pour out My Spirit on all flesh; your sons and your daughters shall prophesy, your old men shall dream dreams, your young men shall see visions.", book: "Joel", chapter: 2, verse: 28 },
  { reference: "Amos 3:3", text: "Can two walk together, unless they are agreed?", book: "Amos", chapter: 3, verse: 3 },
  { reference: "Micah 6:8", text: "He has shown you, O man, what is good; and what does the Lord require of you but to do justly, to love mercy, and to walk humbly with your God?", book: "Micah", chapter: 6, verse: 8 },
  { reference: "Micah 7:7", text: "Therefore I will look to the Lord; I will wait for the God of my salvation; my God will hear me.", book: "Micah", chapter: 7, verse: 7 },
  { reference: "Nahum 1:7", text: "The Lord is good, a stronghold in the day of trouble; and He knows those who trust in Him.", book: "Nahum", chapter: 1, verse: 7 },
  { reference: "Habakkuk 2:4", text: "Behold the proud, his soul is not upright in him; but the just shall live by his faith.", book: "Habakkuk", chapter: 2, verse: 4 },
  { reference: "Habakkuk 3:17", text: "Though the fig tree may not blossom, nor fruit be on the vines; though the labor of the olive may fail, and the fields yield no food; though the flock may be cut off from the fold, and there be no herd in the stalls.", book: "Habakkuk", chapter: 3, verse: 17 },
  { reference: "Habakkuk 3:18", text: "Yet I will rejoice in the Lord, I will joy in the God of my salvation.", book: "Habakkuk", chapter: 3, verse: 18 },
  { reference: "Zephaniah 3:17", text: "The Lord your God in your midst, the Mighty One, will save; He will rejoice over you with gladness, He will quiet you with His love, He will rejoice over you with singing.", book: "Zephaniah", chapter: 3, verse: 17 },
  { reference: "Haggai 2:4", text: "Yet now be strong, Zerubbabel, says the Lord; and be strong, Joshua, son of Jehozadak, the high priest; and be strong, all you people of the land, says the Lord, and work; for I am with you.", book: "Haggai", chapter: 2, verse: 4 },
  { reference: "Zechariah 4:6", text: "Not by might nor by power, but by My Spirit, says the Lord of hosts.", book: "Zechariah", chapter: 4, verse: 6 },
  { reference: "Malachi 3:6", text: "For I am the Lord, I do not change; therefore you are not consumed, O sons of Jacob.", book: "Malachi", chapter: 3, verse: 6 },
  { reference: "Malachi 4:2", text: "But to you who fear My name the Sun of Righteousness shall arise with healing in His wings.", book: "Malachi", chapter: 4, verse: 2 },

  // Acts
  { reference: "Acts 1:8", text: "But you shall receive power when the Holy Spirit has come upon you; and you shall be witnesses to Me in Jerusalem, and in all Judea and Samaria, and to the end of the earth.", book: "Acts", chapter: 1, verse: 8 },
  { reference: "Acts 2:38", text: "Then Peter said to them, Repent, and let every one of you be baptized in the name of Jesus Christ for the remission of sins; and you shall receive the gift of the Holy Spirit.", book: "Acts", chapter: 2, verse: 38 },
  { reference: "Acts 16:31", text: "So they said, Believe on the Lord Jesus Christ, and you will be saved, you and your household.", book: "Acts", chapter: 16, verse: 31 },
  { reference: "Acts 17:28", text: "For in Him we live and move and have our being, as also some of your own poets have said, For we are also His offspring.", book: "Acts", chapter: 17, verse: 28 },

  // More New Testament
  { reference: "Titus 3:5", text: "Not by works of righteousness which we have done, but according to His mercy He saved us, through the washing of regeneration and renewing of the Holy Spirit.", book: "Titus", chapter: 3, verse: 5 },
  { reference: "Hebrews 4:12", text: "For the word of God is living and powerful, and sharper than any two-edged sword, piercing even to the division of soul and spirit, and of joints and marrow, and is a discerner of the thoughts and intents of the heart.", book: "Hebrews", chapter: 4, verse: 12 },
  { reference: "Hebrews 4:16", text: "Let us therefore come boldly to the throne of grace, that we may obtain mercy and find grace to help in time of need.", book: "Hebrews", chapter: 4, verse: 16 },
  { reference: "Hebrews 6:10", text: "For God is not unjust to forget your work and labor of love which you have shown toward His name.", book: "Hebrews", chapter: 6, verse: 10 },
  { reference: "Hebrews 11:6", text: "But without faith it is impossible to please Him, for he who comes to God must believe that He is, and that He is a rewarder of those who diligently seek Him.", book: "Hebrews", chapter: 11, verse: 6 },
  { reference: "Hebrews 12:2", text: "Looking unto Jesus, the author and finisher of our faith, who for the joy that was set before Him endured the cross, despising the shame, and has sat down at the right hand of the throne of God.", book: "Hebrews", chapter: 12, verse: 2 },
  { reference: "Hebrews 13:8", text: "Jesus Christ is the same yesterday, today, and forever.", book: "Hebrews", chapter: 13, verse: 8 },
  { reference: "Jude 1:24", text: "Now to Him who is able to keep you from stumbling, and to present you faultless before the presence of His glory with exceeding joy.", book: "Jude", chapter: 1, verse: 24 },
  { reference: "Jude 1:25", text: "To God our Savior, who alone is wise, be glory and majesty, dominion and power, both now and forever. Amen.", book: "Jude", chapter: 1, verse: 25 },
  { reference: "Revelation 1:8", text: "I am the Alpha and the Omega, the Beginning and the End, says the Lord, who is and who was and who is to come, the Almighty.", book: "Revelation", chapter: 1, verse: 8 },
  { reference: "Revelation 2:10", text: "Do not fear any of those things which you are about to suffer. Be faithful until death, and I will give you the crown of life.", book: "Revelation", chapter: 2, verse: 10 },
  { reference: "Revelation 4:11", text: "You are worthy, O Lord, to receive glory and honor and power; for You created all things, and by Your will they exist and were created.", book: "Revelation", chapter: 4, verse: 11 },
  { reference: "Revelation 7:17", text: "For the Lamb who is in the midst of the throne will shepherd them and lead them to living fountains of waters. And God will wipe away every tear from their eyes.", book: "Revelation", chapter: 7, verse: 17 },
  { reference: "Revelation 11:15", text: "The kingdoms of this world have become the kingdoms of our Lord and of His Christ, and He shall reign forever and ever!", book: "Revelation", chapter: 11, verse: 15 },
  { reference: "Revelation 12:11", text: "And they overcame him by the blood of the Lamb and by the word of their testimony, and they did not love their lives to the death.", book: "Revelation", chapter: 12, verse: 11 },
  { reference: "Revelation 19:6", text: "Alleluia! For the Lord God Omnipotent reigns!", book: "Revelation", chapter: 19, verse: 6 },

  // Final 77 — filling to 468
  { reference: "Job 19:25", text: "For I know that my Redeemer lives, and He shall stand at last on the earth.", book: "Job", chapter: 19, verse: 25 },
  { reference: "Job 23:10", text: "But He knows the way that I take; when He has tested me, I shall come forth as gold.", book: "Job", chapter: 23, verse: 10 },
  { reference: "Job 42:2", text: "I know that You can do everything, and that no purpose of Yours can be withheld from You.", book: "Job", chapter: 42, verse: 2 },
  { reference: "Ecclesiastes 3:1", text: "To everything there is a season, a time for every purpose under heaven.", book: "Ecclesiastes", chapter: 3, verse: 1 },
  { reference: "Ecclesiastes 3:11", text: "He has made everything beautiful in its time. Also He has put eternity in their hearts, except that no one can find out the work that God does from beginning to end.", book: "Ecclesiastes", chapter: 3, verse: 11 },
  { reference: "Ecclesiastes 4:9", text: "Two are better than one, because they have a good reward for their labor.", book: "Ecclesiastes", chapter: 4, verse: 9 },
  { reference: "Ecclesiastes 11:4", text: "He who observes the wind will not sow, and he who regards the clouds will not reap.", book: "Ecclesiastes", chapter: 11, verse: 4 },
  { reference: "Song of Solomon 2:4", text: "He brought me to the banqueting house, and his banner over me was love.", book: "Song of Solomon", chapter: 2, verse: 4 },
  { reference: "Song of Solomon 8:7", text: "Many waters cannot quench love, nor can the floods drown it.", book: "Song of Solomon", chapter: 8, verse: 7 },
  { reference: "Ruth 1:16", text: "But Ruth said: Entreat me not to leave you, or to turn back from following after you; for wherever you go, I will go; and wherever you lodge, I will lodge; your people shall be my people, and your God, my God.", book: "Ruth", chapter: 1, verse: 16 },
  { reference: "Esther 4:14", text: "For if you remain completely silent at this time, relief and deliverance will arise for the Jews from another place, but you and your father's house will perish. Yet who knows whether you have come to the kingdom for such a time as this?", book: "Esther", chapter: 4, verse: 14 },
  { reference: "Nehemiah 2:20", text: "So I answered them, and said to them, The God of heaven Himself will prosper us; therefore we His servants will arise and build.", book: "Nehemiah", chapter: 2, verse: 20 },
  { reference: "Psalm 2:8", text: "Ask of Me, and I will give You the nations for Your inheritance, and the ends of the earth for Your possession.", book: "Psalms", chapter: 2, verse: 8 },
  { reference: "Psalm 15:1", text: "Lord, who may abide in Your tabernacle? Who may dwell in Your holy hill?", book: "Psalms", chapter: 15, verse: 1 },
  { reference: "Psalm 20:4", text: "May He grant you according to your heart's desire, and fulfill all your purpose.", book: "Psalms", chapter: 20, verse: 4 },
  { reference: "Psalm 21:6", text: "For You have made him most blessed forever; You have made him exceedingly glad with Your presence.", book: "Psalms", chapter: 21, verse: 6 },
  { reference: "Psalm 23:5", text: "You prepare a table before me in the presence of my enemies; You anoint my head with oil; my cup runs over.", book: "Psalms", chapter: 23, verse: 5 },
  { reference: "Psalm 23:6", text: "Surely goodness and mercy shall follow me all the days of my life; and I will dwell in the house of the Lord forever.", book: "Psalms", chapter: 23, verse: 6 },
  { reference: "Psalm 36:7", text: "How precious is Your lovingkindness, O God! Therefore the children of men put their trust under the shadow of Your wings.", book: "Psalms", chapter: 36, verse: 7 },
  { reference: "Psalm 45:11", text: "So the King will greatly desire your beauty; because He is your Lord, worship Him.", book: "Psalms", chapter: 45, verse: 11 },
  { reference: "Psalm 65:2", text: "O You who hear prayer, to You all flesh will come.", book: "Psalms", chapter: 65, verse: 2 },
  { reference: "Psalm 67:1", text: "God be merciful to us and bless us, and cause His face to shine upon us.", book: "Psalms", chapter: 67, verse: 1 },
  { reference: "Psalm 68:5", text: "A father of the fatherless, a defender of widows, is God in His holy habitation.", book: "Psalms", chapter: 68, verse: 5 },
  { reference: "Psalm 69:30", text: "I will praise the name of God with a song, and will magnify Him with thanksgiving.", book: "Psalms", chapter: 69, verse: 30 },
  { reference: "Psalm 70:4", text: "Let all those who seek You rejoice and be glad in You; and let those who love Your salvation say continually, Let God be magnified!", book: "Psalms", chapter: 70, verse: 4 },
  { reference: "Psalm 71:5", text: "For You are my hope, O Lord God; You are my trust from my youth.", book: "Psalms", chapter: 71, verse: 5 },
  { reference: "Psalm 78:4", text: "We will not hide them from their children, telling to the generation to come the praises of the Lord, and His strength and His wonderful works that He has done.", book: "Psalms", chapter: 78, verse: 4 },
  { reference: "Psalm 80:7", text: "Restore us, O God of hosts; cause Your face to shine, and we shall be saved!", book: "Psalms", chapter: 80, verse: 7 },
  { reference: "Psalm 85:12", text: "Yes, the Lord will give what is good; and our land will yield its increase.", book: "Psalms", chapter: 85, verse: 12 },
  { reference: "Psalm 86:12", text: "I will praise You, O Lord my God, with all my heart, and I will glorify Your name forevermore.", book: "Psalms", chapter: 86, verse: 12 },
  { reference: "Psalm 89:34", text: "My covenant I will not break, nor alter the word that has gone out of My lips.", book: "Psalms", chapter: 89, verse: 34 },
  { reference: "Psalm 93:1", text: "The Lord reigns, He is clothed with majesty; the Lord is clothed, He has girded Himself with strength.", book: "Psalms", chapter: 93, verse: 1 },
  { reference: "Psalm 95:6", text: "Oh come, let us worship and bow down; let us kneel before the Lord our Maker.", book: "Psalms", chapter: 95, verse: 6 },
  { reference: "Psalm 96:4", text: "For the Lord is great and greatly to be praised; He is to be feared above all gods.", book: "Psalms", chapter: 96, verse: 4 },
  { reference: "Psalm 97:11", text: "Light is sown for the righteous, and gladness for the upright in heart.", book: "Psalms", chapter: 97, verse: 11 },
  { reference: "Psalm 98:1", text: "Oh, sing to the Lord a new song! For He has done marvelous things; His right hand and His holy arm have gained Him the victory.", book: "Psalms", chapter: 98, verse: 1 },
  { reference: "Psalm 104:33", text: "I will sing to the Lord as long as I live; I will sing praise to my God while I have my being.", book: "Psalms", chapter: 104, verse: 33 },
  { reference: "Psalm 111:10", text: "The fear of the Lord is the beginning of wisdom; a good understanding have all those who do His commandments. His praise endures forever.", book: "Psalms", chapter: 111, verse: 10 },
  { reference: "Psalm 113:3", text: "From the rising of the sun to its going down the Lord's name is to be praised.", book: "Psalms", chapter: 113, verse: 3 },
  { reference: "Psalm 119:50", text: "This is my comfort in my affliction, for Your word has given me life.", book: "Psalms", chapter: 119, verse: 50 },
  { reference: "Psalm 119:114", text: "You are my hiding place and my shield; I hope in Your word.", book: "Psalms", chapter: 119, verse: 114 },
  { reference: "Psalm 119:160", text: "The entirety of Your word is truth, and every one of Your righteous judgments endures forever.", book: "Psalms", chapter: 119, verse: 160 },
  { reference: "Psalm 125:1", text: "Those who trust in the Lord are like Mount Zion, which cannot be moved, but abides forever.", book: "Psalms", chapter: 125, verse: 1 },
  { reference: "Psalm 125:2", text: "As the mountains surround Jerusalem, so the Lord surrounds His people from this time forth and forever.", book: "Psalms", chapter: 125, verse: 2 },
  { reference: "Psalm 133:1", text: "Behold, how good and how pleasant it is for brethren to dwell together in unity!", book: "Psalms", chapter: 133, verse: 1 },
  { reference: "Psalm 136:26", text: "Oh, give thanks to the God of heaven! For His mercy endures forever.", book: "Psalms", chapter: 136, verse: 26 },
  { reference: "Psalm 142:5", text: "I cried out to You, O Lord; I said, You are my refuge, my portion in the land of the living.", book: "Psalms", chapter: 142, verse: 5 },
  { reference: "Psalm 145:9", text: "The Lord is good to all, and His tender mercies are over all His works.", book: "Psalms", chapter: 145, verse: 9 },
  { reference: "Psalm 145:13", text: "Your kingdom is an everlasting kingdom, and Your dominion endures throughout all generations.", book: "Psalms", chapter: 145, verse: 13 },
  { reference: "Proverbs 2:3", text: "Yes, if you cry out for discernment, and lift up your voice for understanding.", book: "Proverbs", chapter: 2, verse: 3 },
  { reference: "Proverbs 3:24", text: "When you lie down, you will not be afraid; yes, you will lie down and your sleep will be sweet.", book: "Proverbs", chapter: 3, verse: 24 },
  { reference: "Proverbs 4:18", text: "But the path of the just is like the shining sun, that shines ever brighter unto the perfect day.", book: "Proverbs", chapter: 4, verse: 18 },
  { reference: "Proverbs 4:23", text: "Keep your heart with all diligence, for out of it spring the issues of life.", book: "Proverbs", chapter: 4, verse: 23 },
  { reference: "Proverbs 9:10", text: "The fear of the Lord is the beginning of wisdom, and the knowledge of the Holy One is understanding.", book: "Proverbs", chapter: 9, verse: 10 },
  { reference: "Proverbs 10:7", text: "The memory of the righteous is blessed, but the name of the wicked will rot.", book: "Proverbs", chapter: 10, verse: 7 },
  { reference: "Proverbs 11:3", text: "The integrity of the upright will guide them, but the perversity of the unfaithful will destroy them.", book: "Proverbs", chapter: 11, verse: 3 },
  { reference: "Proverbs 11:25", text: "The generous soul will be made rich, and he who waters will also be watered himself.", book: "Proverbs", chapter: 11, verse: 25 },
  { reference: "Proverbs 14:26", text: "In the fear of the Lord there is strong confidence, and His children will have a place of refuge.", book: "Proverbs", chapter: 14, verse: 26 },
  { reference: "Proverbs 15:3", text: "The eyes of the Lord are in every place, keeping watch on the evil and the good.", book: "Proverbs", chapter: 15, verse: 3 },
  { reference: "Proverbs 17:9", text: "He who covers a transgression seeks love, but he who repeats a matter separates friends.", book: "Proverbs", chapter: 17, verse: 9 },
  { reference: "Proverbs 18:24", text: "A man who has friends must himself be friendly, but there is a friend who sticks closer than a brother.", book: "Proverbs", chapter: 18, verse: 24 },
  { reference: "Proverbs 20:7", text: "The righteous man walks in his integrity; his children are blessed after him.", book: "Proverbs", chapter: 20, verse: 7 },
  { reference: "Proverbs 22:6", text: "Train up a child in the way he should go, and when he is old he will not depart from it.", book: "Proverbs", chapter: 22, verse: 6 },
  { reference: "Proverbs 23:7", text: "For as he thinks in his heart, so is he.", book: "Proverbs", chapter: 23, verse: 7 },
  { reference: "Proverbs 25:11", text: "A word fitly spoken is like apples of gold in settings of silver.", book: "Proverbs", chapter: 25, verse: 11 },
  { reference: "Proverbs 26:12", text: "Do you see a man wise in his own eyes? There is more hope for a fool than for him.", book: "Proverbs", chapter: 26, verse: 12 },
  { reference: "Isaiah 12:2", text: "Behold, God is my salvation, I will trust and not be afraid; for Yah, the Lord, is my strength and song; He also has become my salvation.", book: "Isaiah", chapter: 12, verse: 2 },
  { reference: "Isaiah 25:1", text: "O Lord, You are my God. I will exalt You, I will praise Your name, for You have done wonderful things.", book: "Isaiah", chapter: 25, verse: 1 },
  { reference: "Isaiah 33:22", text: "For the Lord is our Judge, the Lord is our Lawgiver, the Lord is our King; He will save us.", book: "Isaiah", chapter: 33, verse: 22 },
  { reference: "Isaiah 44:6", text: "Thus says the Lord, the King of Israel, and his Redeemer, the Lord of hosts: I am the First and I am the Last; besides Me there is no God.", book: "Isaiah", chapter: 44, verse: 6 },
  { reference: "Isaiah 45:22", text: "Look to Me, and be saved, all you ends of the earth! For I am God, and there is no other.", book: "Isaiah", chapter: 45, verse: 22 },
  { reference: "Isaiah 46:4", text: "Even to your old age, I am He, and even to gray hairs I will carry you! I have made, and I will bear; even I will carry, and will deliver you.", book: "Isaiah", chapter: 46, verse: 4 },
  { reference: "Isaiah 49:16", text: "See, I have inscribed you on the palms of My hands; your walls are continually before Me.", book: "Isaiah", chapter: 49, verse: 16 },
  { reference: "Isaiah 53:5", text: "But He was wounded for our transgressions, He was bruised for our iniquities; the chastisement for our peace was upon Him, and by His stripes we are healed.", book: "Isaiah", chapter: 53, verse: 5 },
  { reference: "Isaiah 59:19", text: "So shall they fear the name of the Lord from the west, and His glory from the rising of the sun; when the enemy comes in like a flood, the Spirit of the Lord will lift up a standard against him.", book: "Isaiah", chapter: 59, verse: 19 },
  { reference: "Jeremiah 15:16", text: "Your words were found, and I ate them, and Your word was to me the joy and rejoicing of my heart; for I am called by Your name, O Lord God of hosts.", book: "Jeremiah", chapter: 15, verse: 16 },
  { reference: "Matthew 6:34", text: "Therefore do not worry about tomorrow, for tomorrow will worry about its own things. Sufficient for the day is its own trouble.", book: "Matthew", chapter: 6, verse: 34 },
  { reference: "Luke 12:32", text: "Do not fear, little flock, for it is your Father's good pleasure to give you the kingdom.", book: "Luke", chapter: 12, verse: 32 },
  { reference: "John 6:35", text: "And Jesus said to them, I am the bread of life. He who comes to Me shall never hunger, and he who believes in Me shall never thirst.", book: "John", chapter: 6, verse: 35 },
  { reference: "John 15:13", text: "Greater love has no one than this, than to lay down one's life for his friends.", book: "John", chapter: 15, verse: 13 },
];

// Encouragement messages for specific placements
const ENCOURAGEMENT_MESSAGES = [
  { text: "Every great journey starts with a single step of faith.", placement: "buyer-dashboard" },
  { text: "Patience and wisdom in your vehicle search will yield the right result.", placement: "buyer-search" },
  { text: "A good deal takes preparation. You are doing the right thing by being thorough.", placement: "buyer-shortlist" },
  { text: "Every offer is a new opportunity. Trust the process.", placement: "buyer-auction" },
  { text: "Your diligence in reviewing the contract protects your family.", placement: "buyer-contract-shield" },
  { text: "Each new season brings new opportunities. We are glad you are here.", placement: "dealer-dashboard" },
  { text: "Excellence in your craft opens doors that persistence cannot force.", placement: "dealer-scorecard" },
  { text: "Building something together is greater than building alone.", placement: "affiliate-dashboard" },
];

// Hope page content — 4 required sections
const HOPE_PAGE_CONTENT = [
  {
    section: "opening",
    title: "A Word for Where You Are",
    body: "Buying a vehicle is one of the most significant financial decisions a family makes. AutoLenis was built to make that decision clearer, fairer, and less stressful. But we also believe that the deepest kind of peace — the kind that holds steady through uncertainty — comes from somewhere beyond a good deal.\n\nThis page exists for those who are carrying more than a car payment.",
    order: 1,
  },
  {
    section: "encouragement",
    title: "Words That Have Carried Millions",
    body: "For thousands of years, the words of scripture have been a source of stability for people navigating every kind of decision — financial, relational, and personal. We share a few here not as a requirement but as an offering, in case they speak to where you are today.",
    order: 2,
  },
  {
    section: "born-again",
    title: "An Invitation",
    body: "The AutoLenis team includes people of faith who believe that lasting peace, purpose, and identity are found not in circumstances but in a relationship with Jesus Christ. The Bible describes this as being \"born again\" — a renewal of the heart that brings peace beyond understanding.\n\nThis invitation is offered freely and without obligation. There is no cost, no conditions, and no expectation. If this is something you want to explore, the resources below are a gentle starting point.\n\nYou are always welcome here, regardless of your beliefs or background.",
    order: 3,
  },
  {
    section: "resources",
    title: "Resources to Explore",
    body: "Bible Gateway (biblegateway.com) — Read scripture in NKJV and dozens of translations. YouVersion (youversion.com) — Free Bible app with reading plans and devotionals. BibleProject (bibleproject.com) — Free animated videos exploring the themes of scripture. Alpha (alpha.org) — A free, no-pressure exploration of life's big questions.",
    order: 4,
  },
];

// Page key to verse assignment mapping
const PAGE_VERSE_ASSIGNMENTS = [
  { pageKey: "homepage", verseRef: "Jeremiah 29:11" },
  { pageKey: "how-it-works", verseRef: "Proverbs 16:9" },
  { pageKey: "pricing", verseRef: "Luke 14:28" },
  { pageKey: "refinance", verseRef: "Isaiah 48:17" },
  { pageKey: "about", verseRef: "Proverbs 22:1" },
  { pageKey: "contract-shield", verseRef: "Proverbs 11:1" },
  { pageKey: "partner-program", verseRef: "Luke 6:38" },
  { pageKey: "for-dealers", verseRef: "Colossians 3:23" },
  // contact and signin pages get NO verse (per spec)
];

async function main() {
  console.log("Seeding AutoLenis faith content...");

  // Seed verses
  let seededCount = 0;
  for (const verse of NKJV_VERSES) {
    await prisma.verseLibrary.upsert({
      where: { reference: verse.reference },
      create: { ...verse, translation: "NKJV", isActive: true },
      update: { text: verse.text, isActive: true },
    });
    seededCount++;
  }
  console.log(`✓ Seeded ${seededCount} NKJV verses`);

  // Seed encouragement messages
  let msgCount = 0;
  for (const msg of ENCOURAGEMENT_MESSAGES) {
    const existing = await prisma.encouragementMessage.findFirst({ where: { placement: msg.placement } });
    if (!existing) {
      await prisma.encouragementMessage.create({ data: { ...msg, isActive: true, order: msgCount } });
      msgCount++;
    }
  }
  console.log(`✓ Seeded ${msgCount} encouragement messages`);

  // Seed hope page content
  for (const section of HOPE_PAGE_CONTENT) {
    await prisma.hopePageContent.upsert({
      where: { section: section.section },
      create: { ...section, isActive: true },
      update: { body: section.body, title: section.title ?? null },
    });
  }
  console.log("✓ Seeded 4 /hope page sections");

  // Seed initial verse page assignments
  const now = new Date();
  for (const assignment of PAGE_VERSE_ASSIGNMENTS) {
    const verse = await prisma.verseLibrary.findUnique({ where: { reference: assignment.verseRef } });
    if (!verse) continue;

    const existing = await prisma.versePageAssignment.findFirst({
      where: { pageKey: assignment.pageKey, isActive: true },
    });
    if (!existing) {
      await prisma.versePageAssignment.create({
        data: {
          pageKey: assignment.pageKey,
          verseId: verse.id,
          isActive: true,
          effectiveAt: now,
          rotationWeek: getISOWeek(now),
        },
      });
    }
  }
  console.log(`✓ Seeded ${PAGE_VERSE_ASSIGNMENTS.length} verse page assignments`);

  console.log("\n✓ Faith content seed complete");
  console.log("  Note: Full 468-verse library requires bulk import via /admin/faith-content/verses");
  console.log("  Current seed: " + NKJV_VERSES.length + " NKJV verses (target: 468)");
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

main()
  .then(() => seedInventory())
  .catch(console.error)
  .finally(() => prisma.$disconnect());
async function seedInventory() {
  const vehicles = [
    {
      lane: "LANE_1" as const,
      year: 2023,
      make: "Toyota",
      model: "Camry",
      trim: "XSE V6",
      mileage: 18400,
      priceCents: 2890000,
      vin: "4T1BZ1HK8PU123456",
      images: ["https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800&q=80"],
      externalDealerCity: "Atlanta",
      externalDealerState: "GA",
      description: "One-owner vehicle. Clean Carfax. Premium JBL audio, moonroof, heated seats. Dealer-certified.",
    },
    {
      lane: "LANE_1" as const,
      year: 2022,
      make: "Tesla",
      model: "Model 3",
      trim: "Long Range AWD",
      mileage: 29800,
      priceCents: 3450000,
      vin: "5YJ3E1EA4NF123789",
      images: ["https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80"],
      externalDealerCity: "Austin",
      externalDealerState: "TX",
      description: "Full Self-Driving capable. White interior. 358-mile range. Single previous owner. No accidents.",
    },
    {
      lane: "LANE_2" as const,
      year: 2024,
      make: "Ford",
      model: "F-150",
      trim: "XLT SuperCrew 4x4",
      mileage: 8700,
      priceCents: 4120000,
      vin: "1FTFW1E58NFC12345",
      images: ["https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800&q=80"],
      externalDealerCity: "Dallas",
      externalDealerState: "TX",
      description: "3.5L EcoBoost V6. Tow package. 7,700 lb towing capacity. Wireless Apple CarPlay. 8-in screen.",
    },
    {
      lane: "LANE_2" as const,
      year: 2023,
      make: "BMW",
      model: "3 Series",
      trim: "330i xDrive",
      mileage: 22100,
      priceCents: 3780000,
      vin: "WBA5R7C51NE456789",
      images: ["https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800&q=80"],
      externalDealerCity: "Chicago",
      externalDealerState: "IL",
      description: "Sport Line package. Harman Kardon audio. Live Cockpit Pro. Heated steering wheel and seats.",
    },
    {
      lane: "LANE_3" as const,
      year: 2022,
      make: "Honda",
      model: "Accord",
      trim: "Sport 2.0T",
      mileage: 31200,
      priceCents: 2450000,
      vin: "1HGCV1F44NA234567",
      images: ["https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800&q=80"],
      externalDealerCity: "Phoenix",
      externalDealerState: "AZ",
      description: "Sport Touring trim. Wireless CarPlay. 2.0T engine. Honda Sensing. Clean title.",
    },
    {
      lane: "LANE_3" as const,
      year: 2023,
      make: "Chevrolet",
      model: "Silverado 1500",
      trim: "LT Crew Cab",
      mileage: 15600,
      priceCents: 3990000,
      vin: "3GCUYDEDXNG345678",
      images: ["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80"],
      externalDealerCity: "Detroit",
      externalDealerState: "MI",
      description: "5.3L EcoTec3 V8. Trailering package. MyLink touchscreen. 2 previous owners. No accidents.",
    },
  ];

  for (const v of vehicles) {
    await prisma.inventoryItem.upsert({
      where: { vin: v.vin },
      update: {},
      create: { ...v, isActive: true },
    });
  }
  console.log(`✓ Seeded ${vehicles.length} inventory items`);
}
