// Apex config: tuning constants, parts, species facts, tiers (M1: t1-t3), paths, validation.
(function () {
  'use strict';
  const A = window.Apex = window.Apex || {};

  // ---------------------------------------------------------------- CFG
  A.CFG = {
    // player / movement
    PLAYER_BASE_R: 12, PLAYER_SPEED: 150, VIEW_R_MULT: 26, EAT_RATIO: 0.92,
    ENERGY_MAX: 100, STARVE_GRACE: 4, COMBO_WINDOW: 2.2,
    DASH_MULT: 2.6, DASH_TIME: 0.25, DASH_CD: 1.1, DASH_COST: 4,
    // hunter attack telegraph
    LUNGE_MULT: 2.3, WINDUP: 0.35, LUNGE_TIME: 0.35, RECOVER: 0.8,
    // eco model
    HARMONY_BAND: [0.6, 1.45], PRODUCER_BAND: [0.45, 1],
    K_MULT: 2.0, RG: 0.02,
    HUNTER_STARVE: 50, HUNTER_BREED_FED: 5, HUNTER_BREED_CAP: 1.75, SATIATED_TIME: 6,
    SPECIES_CAP_MULT: 2.6, MAX_ENTITIES: 230, MIGRATION_DELAY: 12,
    GRAZE_RATE: 0.008, REGROW: 0.02, GRAZER_STARVE: 0.03, // extra eco keys (per second)
    MISHAP_COOLDOWN: 25, MAX_MISHAPS: 2, MISHAP_SUSTAIN: 4,
    // progression
    RESPAWN_GROWTH: 0.4, FORGIVE_GROWTH: 0.5, START_DNA: 15, EVOLVE_DNA: 15, DNA_PER_MASS: 0.6,
    PART_COSTS: [12, 24, 40], ARMOR_RECHARGE: [0, 30, 22, 15],
    // timings
    DECOMPOSE_TIME: 4.5, DECOMPOSE_SKIP: 1.5, INTRO_TIME: 2.2, GRACE: 3, EVOLVE_TIME: 1.6,
    FINAL_HOLD: 45, FINAL_HARMONY: 55, POISON_TIME: 6,
    WORLD: 1200, AIR_ALT: 0.35,
    // combat: health, bite, predator damage (M1.5). hp = HP_PER_MASS x mass; bite damage = BITE_DMG x sqrt(mass) x jaws bonus.
    HP_PER_MASS: 10, BITE_CD: 0.45, BITE_DMG: 9, BITE_SNAP: 0.12, BITE_SNAP_MUL: 1.6,
    BITE_ARC: 60, BITE_REACH: 1.4, BITE_JAWS_BONUS: 0.25, FIGHT_RATIO: 1.35, BIG_DMG_FRAC: 0.15,
    PRED_DMG: 12, PRED_INVULN: 0.6,                      // hunter lunge: PRED_DMG x sqrt(hunter mass), then 0.6s invulnerable
    FLINCH_FRAC: 0.35, FLINCH_WINDOW: 1.2, FLINCH_TIME: 0.5, // >= 35% maxHp in 1.2s stuns the target for 0.5s
    WOUND_FLEE: 0.3, WOUND_RECOVER: 0.5,                 // hunters flee below 30% hp and return once back to 50%
    REGEN: 0.02, REGEN_DELAY: 4, REGEN_ENERGY: 0.3,      // player: 2% maxHp/s after 4s unhurt while energy > 30%
    NPC_REGEN: 0.02, NPC_REGEN_DELAY: 5,
    NIP_DMG: 4, NIP_CD: 1.1, NIP_INVULN: 0.5,            // angry neutral nip = NIP_DMG x sqrt(tier depth)
    ANGRY_TIME: 6, ANGRY_SPEED: 1.15, ANGRY_BUMP_SPEED: 90, ANGRY_LEASH: 400,
    // Difficulty (title screen): growth = pacing multiplier, playerDmg / enemyDmg scale every attack. Base values = Scary.
    DIFFICULTY: {
      easy: { name: 'Easy', growth: 1.5, playerDmg: 1.2, enemyDmg: 1, bossHp: 0.8 },
      normal: { name: 'Normal', growth: 1.25, playerDmg: 1.15, enemyDmg: 1.15, bossHp: 1 },
      scary: { name: 'Scary', growth: 1, playerDmg: 1, enemyDmg: 1, bossHp: 1.15 },
    },
    RESTART_HOLD: 0.7, CARCASS_TIME: 25, CARCASS_GROWTH: 0.5, DECOY_TIME: 3, TIP_TIME: 8,
    TUT_BEETLE_DMG: 0.35,                                // tutorial step 5: beetle damage multiplier
  };

  // ---------------------------------------------------------------- PARTS
  // levels = display name per level (costs live in CFG.PART_COSTS).
  A.PARTS = {
    jaws:   { name: 'Jaws',   slot: 'mouth', desc: 'A stronger bite lets you eat bigger prey.',
              levels: ['Sharp', 'Strong', 'Mighty'], effect: { eatRatio: 0.035 } },
    eyes:   { name: 'Eyes',   slot: 'head',  desc: 'See farther and spot danger sooner.',
              levels: ['Keen', 'Sharp', 'Hawk'], effect: { visionMul: 0.08 } },
    spikes: { name: 'Spikes', slot: 'back',  desc: 'Armor that absorbs one bite, then recharges.',
              levels: ['Spiked', 'Plated', 'Shelled'], effect: { armorMax: 1 } },
    limbs:  { name: 'Limbs',  slot: 'sides', desc: 'Legs, fins or wings for extra speed.',
              levels: ['Strong', 'Swift', 'Sprinter'], effect: { speedMul: 0.07 } },
    tail:   { name: 'Tail',   slot: 'tail',  desc: 'Dash again sooner and farther.',
              levels: ['Long', 'Strong', 'Powerful'], effect: { dashCdMul: -0.15, dashDistMul: 0.1 } },
    gut:    { name: 'Gut',    slot: 'core',  desc: 'Burn less energy and turn meals into more DNA.',
              levels: ['Efficient', 'Hardy', 'Iron'], effect: { drainMul: -0.12, dnaMul: 0.15 } },
    camo:   { name: 'Camo',   slot: 'skin',  desc: 'Hunters notice you from a shorter distance.',
              levels: ['Dappled', 'Hidden', 'Ghost'], effect: { stealthMul: -0.15 } },
  };

  // ---------------------------------------------------------------- SPECIES
  const S = (name, latin, fact, extra) => Object.assign({ name, latin, fact }, extra || {});
  A.SPECIES = {
    // producers
    seed: S('Seed', 'Spermatophyta', 'A seed is a baby plant packed with its own lunch, so it can wait for the right moment to sprout.'),
    fungus: S('Fungus', 'Agaricomycetes', 'Fungi are not plants. Their hidden threads break down dead leaves and pass the nutrients back to the soil.'),
    clover: S('Clover', 'Trifolium repens', 'Clover roots team up with bacteria that turn air into plant food, which fertilizes the soil around them.'),
    reeds: S('Reeds', 'Phragmites australis', 'Reed beds clean pond water and give fish, frogs and insects a safe place to hide.'),
    lilypad: S('Lily Pad', 'Nymphaea alba', 'Lily pads float on air pockets inside their leaves, and frogs use them as resting platforms.'),
    carcass: S('Carcass', 'Cadaver', 'A fresh kill is a feast. Scavengers, beetles and fungi will finish what a hunter leaves behind.'),
    decoy: S('Tail decoy', 'Plestiodon fasciatus', 'A skink tail keeps wriggling for minutes after it drops off, which keeps a hunter busy while the skink slips away.'),
    carrion: S('Remains', 'Detritus', 'Nothing is wasted in nature. Dead animals feed flies, beetles and fungi, and what is left enriches the soil.'),
    // invertebrates
    mite: S('Soil Mite', 'Oribatida', 'A single handful of forest soil can hold thousands of mites, quietly helping to break down dead leaves.'),
    springtail: S('Springtail', 'Folsomia candida', 'Springtails flick a tiny spring folded under their belly to launch themselves many body lengths away.'),
    aphid: S('Aphid', 'Aphis fabae', 'Aphids can have babies without mating, so a few can become a swarm in days. Ants even herd them for sweet honeydew.'),
    caterpillar: S('Caterpillar', 'Pieris rapae', 'A caterpillar eats almost nonstop and grows many times its size before turning into a butterfly.'),
    beetle: S('Ground Beetle', 'Carabus nemoralis', 'Ground beetles are speedy night hunters, and many squirt a smelly liquid to scare off enemies.',
      { playable: true, innate: { spikes: 1 },
        ability: { id: 'charge', name: 'Horn charge', blurb: 'Ram forward and stun whatever you hit.', cd: 8, dur: 0.4, speedMul: 2.4, stunT: 1, dmgMul: 2 } }),
    spider: S('Wolf Spider', 'Hogna carolinensis', 'Wolf spiders hunt by sight and speed instead of webs, and mothers carry their babies on their backs.',
      { playable: true, innate: { jaws: 1 },
        ability: { id: 'web', name: 'Web throw', blurb: 'Throw a web at the pointer that slows everything caught in it.', cd: 9, r: 3, dur: 5, slowMul: 0.3, range: 9 } }),
    centipede: S('Centipede', 'Lithobius forficatus', 'Centipedes have one pair of legs on each body segment, and their front pair are venom fangs.'),
    ant: S('Black Ant', 'Lasius niger', 'Ants leave scent trails for their nest mates, and one colony can hold thousands of workers.',
      { playable: true, innate: { limbs: 1 },
        ability: { id: 'spray', name: 'Formic spray', blurb: 'Spray acid in a cone: it hurts and slows.', cd: 8, arc: 90, range: 3, dmgMul: 1.2, slowMul: 0.6, slowT: 2 } }),
    pillbug: S('Pillbug', 'Armadillidium vulgare', 'Pillbugs are crustaceans, cousins of crabs, not insects. They curl into a ball to protect themselves.',
      { playable: true, innate: { spikes: 1 },
        ability: { id: 'roll', name: 'Roll up', blurb: 'Curl into a ball. Nothing can hurt you for 2 seconds.', cd: 10, dur: 2, speedMul: 0.5, knock: 520, stunT: 0.3 } }),
    fly: S('Housefly', 'Musca domestica', 'Flies see the world through compound eyes with thousands of lenses, and they taste with their feet.'),
    cricket: S('Field Cricket', 'Gryllus campestris', 'Male crickets chirp by rubbing their wings together, and faster chirps mean warmer air.'),
    worm: S('Earthworm', 'Lumbricus terrestris', 'Earthworms tunnel through soil, letting air and water reach plant roots, and their droppings are rich plant food.'),
    dragonfly: S('Dragonfly', 'Anax junius', 'Dragonflies are among the best hunters in nature, and they can fly in any direction, even backward.'),
    grasshopper: S('Grasshopper', 'Chorthippus brunneus', 'Grasshoppers hear with ears on their belly, and they leap using huge back legs.'),
    // vertebrates
    skink: S('Five-lined Skink', 'Plestiodon fasciatus', 'A skink can drop its tail to escape a predator, and a new one grows back.',
      { playable: true, innate: { limbs: 1 },
        ability: { id: 'tail', name: 'Tail drop', blurb: 'Drop a wriggling tail that hunters chase, then sprint away.', cd: 12, decoyT: 3, speedMul: 1.4, speedT: 1.5 } }),
    frog: S('Green Frog', 'Lithobates clamitans', 'Frogs drink and breathe partly through their skin, so they need to stay wet.',
      { playable: true, innate: { tail: 1 },
        ability: { id: 'tongue', name: 'Tongue snatch', blurb: 'Snatch the nearest edible bug. Anything too big is stunned.', cd: 6, range: 6, stunT: 0.6, missCd: 0.6 } }),
    shrew: S('Common Shrew', 'Sorex araneus', 'A shrew eats most of its own body weight every day, so it is always on the hunt for bugs.'),
    tadpole: S('Tadpole', 'Rana temporaria', 'Tadpoles breathe with gills and swim with a tail, then grow legs and lungs to become frogs.'),
    weasel: S('Least Weasel', 'Mustela nivalis', 'The least weasel is the smallest meat-eating mammal, and its skinny body slips right into mouse burrows.',
      { playable: true, innate: { limbs: 1 },
        ability: { id: 'charge', name: 'Pounce', blurb: 'Spring forward and stun whatever you hit.', cd: 7, dur: 0.35, speedMul: 2.5, stunT: 0.9, dmgMul: 1.8 } }),
    snake: S('Garter Snake', 'Thamnophis sirtalis', 'Snakes flick their tongues to collect scents from the air and ground, so they can smell where prey went.',
      { playable: true, innate: { camo: 1 },
        ability: { id: 'spray', name: 'Musk spray', blurb: 'Garter snakes release a foul musk: it hurts and slows anything in front of you.', cd: 8, arc: 80, range: 3, dmgMul: 1.1, slowMul: 0.55, slowT: 2.2 } }),
    heron: S('Great Blue Heron', 'Ardea herodias', 'A heron can stand perfectly still for minutes, then spear a fish with a lightning-fast neck strike.'),
    // M2 land path: producers
    grass: S('Meadow Grass', 'Poa pratensis', 'Grass grows from the base of the leaf, not the tip, so it keeps growing back after grazers bite it.'),
    berries: S('Bilberries', 'Vaccinium myrtillus', 'Forest berries feed bears, foxes and birds, which spread the seeds in their droppings far from the parent bush.'),
    willow: S('Willow', 'Salix exigua', 'Willows along valley streams hold the banks together with their roots, and elk love to browse their shoots.'),
    // M2 land path: animals
    mouse: S('Field Mouse', 'Apodemus sylvaticus', 'A field mouse can have a new litter every month, which is why so many hunters depend on mice.'),
    vole: S('Meadow Vole', 'Microtus pennsylvanicus', 'Voles dig tunnels under the grass and snow, and their numbers can boom and crash every few years.'),
    songbird: S('Meadowlark', 'Sturnella magna', 'Meadowlarks nest on the ground, hidden in the grass, and sing from fence posts to claim their patch.'),
    rabbit: S('Cottontail Rabbit', 'Sylvilagus floridanus', 'A rabbit\'s eyes sit high on the sides of its head, so it can watch almost all the way around without turning.'),
    hawk: S('Red-tailed Hawk', 'Buteo jamaicensis', 'Red-tailed hawks circle high on warm air, then drop feet-first onto mice and voles they spotted from far above.'),
    fox: S('Red Fox', 'Vulpes vulpes', 'A fox can hear a mouse squeak under snow, then leaps high and dives nose-first to catch it.',
      { playable: true, innate: { gut: 1 }, omni: true,
        ability: { id: 'tongue', name: 'Mouse pounce', blurb: 'Leap onto the nearest thing you can eat. Anything too big is stunned.', cd: 6, range: 6, stunT: 0.6, missCd: 0.6 } }),
    lynx: S('Canada Lynx', 'Lynx canadensis', 'A lynx has huge furry paws that work like snowshoes, and it mostly hunts snowshoe hares.',
      { playable: true, innate: { camo: 1 },
        ability: { id: 'charge', name: 'Ambush leap', blurb: 'Burst out of hiding and stun whatever you hit.', cd: 8, dur: 0.4, speedMul: 2.6, stunT: 1, dmgMul: 2.2 } }),
    squirrel: S('Red Squirrel', 'Tamiasciurus hudsonicus', 'A red squirrel buries thousands of seeds and forgets some, which grow into new trees.'),
    grouse: S('Ruffed Grouse', 'Bonasa umbellus', 'In spring a male grouse beats his wings so fast the air makes a drumming sound you can hear far away.'),
    hare: S('Snowshoe Hare', 'Lepus americanus', 'Snowshoe hares turn white in winter and brown in summer, so they always match the ground.'),
    wolverine: S('Wolverine', 'Gulo gulo', 'Wolverines are fearless for their size and will chase much bigger animals off a meal.'),
    wolf: S('Gray Wolf', 'Canis lupus', 'Wolves hunt as a family pack, taking turns chasing so the whole pack can bring down big prey like elk.',
      { playable: true, innate: { limbs: 1 },
        ability: { id: 'spray', name: 'Howl', blurb: 'Howl at the animals in front of you: they flinch and slow down.', cd: 9, arc: 140, range: 4, dmgMul: 0.35, slowMul: 0.5, slowT: 2.5 } }),
    bear: S('Grizzly Bear', 'Ursus arctos', 'Grizzlies eat berries, roots and fish as well as meat, and can smell food from kilometres away.',
      { playable: true, innate: { spikes: 1 }, omni: true,
        ability: { id: 'roll', name: 'Brace', blurb: 'Plant your feet and shrug off every hit for 2 seconds, knocking attackers back.', cd: 10, dur: 2, speedMul: 0.5, knock: 620, stunT: 0.4 } }),
    boar: S('Wild Boar', 'Sus scrofa', 'Boars plough up the soil with their snouts looking for roots and grubs, which helps new plants sprout.'),
    deer: S('Mule Deer', 'Odocoileus hemionus', 'Mule deer bounce on all four legs at once, a jump called stotting that shows hunters they are hard to catch.'),
    cavebear: S('The Old One', 'Ursus spelaeus', 'Cave bears were real: giant Ice Age bears up to twice the weight of a grizzly. They died out about 24,000 years ago.'),
    elk: S('Elk', 'Cervus canadensis', 'Bull elk grow a new set of antlers every year, and they can weigh as much as a child.'),
  };

  // ---------------------------------------------------------------- TIERS
  // Roster entry helper: sp, role, beh, r, n0, speed.
  const E = (sp, role, beh, r, n0, speed) => ({ sp, role, beh, r, n0, speed });
  const P = (sp, r, n0) => E(sp, 'producer', 'static', r, n0, 0);
  const Gz = (sp, beh, r, n0, speed) => E(sp, 'grazer', beh, r, n0, speed);
  const H = (sp, beh, r, n0, speed) => E(sp, 'hunter', beh, r, n0, speed);
  const Z = (entry, zone) => Object.assign(entry, { zone });   // keep an entry in one zone of a zoned biome

  A.TIERS = {
    t1_litter: {
      id: 't1_litter', depth: 1, path: 'shared', biome: 'litter', habitat: 'land',
      name: 'Leaf Litter', blurb: 'A tiny jungle of fallen leaves. Eat the small, dodge the big.',
      players: ['ant', 'pillbug'], next: ['t2_under'], prev: null,
      maxScale: 1.7, growthNeeded: 140, drain: 1.4, world: 1200,
      rgMul: 1.25, // optional: fewer prey here (n0 total 71), so they breed faster to stay forgiving
      roster: [
        P('seed', 6, 16), P('fungus', 10, 14),
        Gz('mite', 'graze', 3, 22, 55), Gz('springtail', 'hop', 4, 18, 80),
        Gz('aphid', 'graze', 5, 24, 55), Gz('caterpillar', 'graze', 14, 7, 95),
        H('beetle', 'chase', 20, 2, 120), H('spider', 'stalk', 24, 2, 125), H('centipede', 'ambush', 40, 1, 135),
      ],
      mishaps: {
        famine: { title: 'Hunger in the Litter', text: 'So many small bugs are gone that hungry hunters are chasing you instead.' },
        boom: { title: '{sp} Plague', text: 'With too few hunters, {sp} multiplied fast and are stripping the seeds and fungi.' },
        disease: { title: 'Sickness Spreads', text: 'Crowded {sp} passed an illness around; eating a sick one will poison you.' },
        barren: { title: 'Barren Litter', text: 'The plants were nibbled down faster than they can regrow, so the grazers are starving.' },
        surge: { title: 'Hunter Surge', text: 'Plenty of prey drew in more beetles and spiders, so more hunters now roam the litter.' },
      },
    },
    t2_under: {
      id: 't2_under', depth: 2, path: 'shared', biome: 'undergrowth', habitat: 'land',
      name: 'Undergrowth', blurb: 'Tall stems and thick shade hide bigger hunters. Stay sneaky.',
      players: ['spider', 'beetle'], next: ['t3_pond'], prev: 't1_litter',
      maxScale: 1.7, growthNeeded: 300, drain: 1.4, world: 1200,
      roster: [
        P('clover', 9, 16), P('fungus', 10, 12),
        Gz('aphid', 'graze', 4, 22, 55), Gz('ant', 'swarm', 6, 16, 70), Gz('fly', 'flit', 5, 16, 150),
        Gz('caterpillar', 'graze', 8, 14, 60), Gz('pillbug', 'graze', 9, 12, 55),
        Gz('cricket', 'hop', 14, 6, 100), Gz('worm', 'graze', 16, 6, 90),
        H('skink', 'chase', 24, 2, 125), H('frog', 'ambush', 26, 2, 120), H('shrew', 'chase', 34, 1, 135),
      ],
      mishaps: {
        famine: { title: 'Famine in the Undergrowth', text: 'Prey ran short, so skinks, frogs and shrews are getting desperate and hunting you.' },
        boom: { title: '{sp} Boom', text: 'Without enough predators, {sp} exploded in number and are eating the clover down.' },
        disease: { title: 'Outbreak', text: 'Packed-together {sp} spread a sickness; eating a sick one will poison you.' },
        barren: { title: 'Bare Ground', text: 'Over-grazing stripped the clover, so there is little left to feed the grazers.' },
        surge: { title: 'Predator Surge', text: 'An easy supply of prey brought in extra skinks, frogs and shrews.' },
      },
    },
    t3_pond: {
      id: 't3_pond', depth: 3, path: 'shared', biome: 'pond', habitat: 'land',
      name: 'Pond Edge', blurb: 'Reeds, water and open mud. Herons watch from above.',
      players: ['frog', 'skink'],
      next: ['t4_meadow'], // M3 adds 't4_marsh' (sky) and 't4_river' (sea)
      prev: 't2_under',
      maxScale: 2.0, growthNeeded: 320, drain: 1.4, world: 1200,
      roster: [
        P('reeds', 12, 14), P('lilypad', 14, 14),
        Gz('fly', 'flit', 3, 20, 150), Gz('cricket', 'hop', 6, 14, 90), Gz('tadpole', 'school', 6, 16, 70),
        Gz('worm', 'graze', 7, 12, 60), Gz('spider', 'scurry', 8, 12, 75), Gz('beetle', 'graze', 9, 12, 70),
        Gz('dragonfly', 'flit', 14, 6, 160), Gz('grasshopper', 'hop', 16, 6, 100),
        H('weasel', 'chase', 28, 1, 135), H('snake', 'stalk', 30, 2, 120), H('heron', 'ambush', 50, 1, 130),
      ],
      mishaps: {
        famine: { title: 'Famine at the Pond', text: 'The pond is short of prey, so weasels, snakes and herons are getting desperate and hunting you.' },
        boom: { title: '{sp} Boom', text: 'Few hunters were left to keep them in check, so {sp} swarmed the pond and are eating the reeds.' },
        disease: { title: 'Pond Sickness', text: 'Crowded {sp} spread a disease; eating a sick one will poison you.' },
        barren: { title: 'Stripped Shore', text: 'The reeds and lily pads were eaten faster than they can grow back, so the grazers are starving.' },
        surge: { title: 'Predator Surge', text: 'So much prey around the pond drew in extra weasels, snakes and herons.' },
      },
    },
    // ---------------------------------------------------------- M2 land path: spring, autumn, early winter
    t4_meadow: {
      id: 't4_meadow', depth: 4, path: 'land', biome: 'meadow', habitat: 'land',
      name: 'Spring Meadow', blurb: 'Fresh grass and wildflowers. Hawks circle overhead, foxes creep through the stems.',
      players: ['snake', 'weasel'], next: ['t5_forest'], prev: 't3_pond',
      maxScale: 1.7, growthNeeded: 460, drain: 1.4, world: 1200,
      roster: [
        P('grass', 12, 18),
        Gz('grasshopper', 'hop', 4, 20, 90), Gz('frog', 'hop', 8, 10, 85), Gz('skink', 'scurry', 8, 10, 100),
        Gz('mouse', 'scurry', 9, 14, 95), Gz('vole', 'graze', 10, 12, 70),
        Gz('songbird', 'flock', 14, 7, 140), Gz('rabbit', 'hop', 17, 6, 115),
        H('fox', 'stalk', 32, 2, 125), H('hawk', 'dive', 40, 1, 135),
      ],
      mishaps: {
        famine: { title: 'Hungry Meadow', text: 'So few small animals are left that the foxes and hawks are hunting you instead.' },
        boom: { title: '{sp} Explosion', text: 'With too few hunters, {sp} bred out of control and are mowing the grass down.' },
        disease: { title: 'Meadow Sickness', text: 'Crowded {sp} passed a disease around; eating a sick one will poison you.' },
        barren: { title: 'Grazed Bare', text: 'The grass was eaten faster than it can grow back, so the grazers are starving.' },
        surge: { title: 'Hunter Surge', text: 'Plenty of prey drew in more foxes and hawks.' },
      },
    },
    t5_forest: {
      id: 't5_forest', depth: 5, path: 'land', biome: 'forest', habitat: 'land',
      name: 'Autumn Forest', blurb: 'Falling leaves and ripe berries. Wolves and a bear are fattening up for winter.',
      players: ['fox', 'lynx'], next: ['t6_valley'], prev: 't4_meadow',
      maxScale: 1.7, growthNeeded: 360, drain: 1.4, world: 1200,
      roster: [   // two zones (world.js): birch wood and pine forest, each with its own animals
        P('berries', 12, 16),
        Z(Gz('mouse', 'scurry', 4, 22, 95), 'pine'), Z(Gz('squirrel', 'scurry', 7, 14, 110), 'pine'), Z(Gz('snake', 'graze', 8, 10, 70), 'birch'),
        Z(Gz('rabbit', 'hop', 9, 12, 110), 'birch'), Z(Gz('grouse', 'flock', 13, 7, 120), 'birch'), Z(Gz('hare', 'hop', 16, 6, 125), 'pine'),
        Z(H('wolverine', 'chase', 30, 1, 125), 'pine'), Z(H('wolf', 'pack', 32, 2, 130), 'birch'), H('bear', 'charge', 55, 1, 115),
      ],
      mishaps: {
        famine: { title: 'Lean Autumn', text: 'The forest ran short of prey, so the wolves and the bear are desperate and coming for you.' },
        boom: { title: '{sp} Boom', text: 'With too few hunters, {sp} multiplied and are stripping the berry bushes.' },
        disease: { title: 'Forest Sickness', text: 'Crowded {sp} spread a disease; eating a sick one will poison you.' },
        barren: { title: 'Picked Clean', text: 'The berries were eaten faster than the bushes can ripen more, so the grazers are starving.' },
        surge: { title: 'Wolves Gather', text: 'So much prey drew in extra wolves and wolverines.' },
      },
    },
    t6_valley: {
      id: 't6_valley', depth: 6, path: 'land', biome: 'valley', habitat: 'land',
      name: 'Winter Valley', blurb: 'Frost on the willows and elk in the river bottom. Rule the valley without emptying it.',
      players: ['wolf', 'bear'], next: [], prev: 't5_forest', final: true,
      // The legend beast crashes in during the hold (js/boss.js). Damage is a share of your full-grown health.
      boss: { sp: 'cavebear', at: 15, r: 52, hp: 4800, speed: 125, charge: 0.26, swipe: 0.2, slam: 0.32, roar: 0.1 },
      maxScale: 2.6, growthNeeded: 560, drain: 1.4, world: 1200,
      roster: [
        P('willow', 14, 16),
        Gz('hare', 'hop', 5, 18, 120), Gz('fox', 'scurry', 9, 10, 115), Gz('boar', 'graze', 13, 8, 95),
        Gz('deer', 'herd', 14, 8, 110), Gz('elk', 'herd', 22, 6, 105),
        H('wolf', 'pack', 24, 2, 125), H('bear', 'charge', 28, 1, 115),
      ],
      mishaps: {
        famine: { title: 'Starving Winter', text: 'Too few grazers are left in the snow, so the other hunters are desperate and coming for you.' },
        boom: { title: 'Too Many {sp}', text: 'Without enough hunters, {sp} crowded the valley and are stripping the willows.' },
        disease: { title: 'Winter Sickness', text: 'Crowded {sp} spread a disease; eating a sick one will poison you.' },
        barren: { title: 'Willow Collapse', text: 'Grazers ate the willows faster than they can regrow. The riverbanks are bare and the grazers are starving.' },
        surge: { title: 'Too Many Hunters', text: 'Plenty of prey drew in extra wolves and bears.' },
      },
    },
  };
  A.TIER_START = 't1_litter';

  // ---------------------------------------------------------------- PATHS
  A.PATHS = {
    land: { name: 'Land', title: 'Top of the valley', color: '#8FD14F', blurb: 'From the meadow to the forest and the valley. Become a wolf or a bear.',
      ending: 'You climbed from a leaf-litter ant to the top predator of the valley, and you did it without wrecking the food web.',
      cascade: 'When wolves returned to Yellowstone in 1995, elk grazed less and kept moving, so willows and aspens regrew along the rivers. Beavers, songbirds and fish moved back in. One predator reshaped a whole landscape. Scientists call this a trophic cascade.' },
    sky: { name: 'Sky', color: '#6EC8FF', blurb: 'From the marsh to the canopy and the cliffs. Rule the air as a golden eagle.',
      ending: 'You rose from a pond-side hunter to a golden eagle ruling the cliffs, with the food web below you still in balance.',
      cascade: 'Eagles that keep marmots and hares in check let mountain meadows stay full of flowers, which feeds bees, seed-eaters and the animals that hunt them. Without hunters, grazers can strip the slopes bare.' },
    sea: { name: 'Sea', color: '#3BC9D9', blurb: 'From the river to the kelp forest and the open ocean. Become an orca or a shark.',
      ending: 'You swam from a river hunter to the top of the open ocean, leaving the food web healthy behind you.',
      cascade: 'In parts of the North Pacific, scientists think orcas hunting more sea otters let sea urchins boom, and the urchins mowed kelp forests into bare seabed. The kelp, and every animal living in it, depended on a hunter far above them.' },
    shared: { name: 'Pond Edge', color: '#C6F25A', blurb: 'The first three steps, shared by every path.',
      ending: 'You made it from a tiny leaf-litter creature to a hunter at the pond edge, and the little world around you stayed healthy.',
      cascade: 'Every animal here was linked. Eat too many grazers and the hunters starve; eat too few and the plants vanish. A keystone predator keeps the balance, and that is exactly the job you just did.' },
  };

  // ---------------------------------------------------------------- MISHAP DEFAULTS
  A.MISHAP_DEFAULTS = {
    famine: { title: 'Famine', text: 'Prey became scarce, so hungry hunters are desperate and chasing you.' },
    boom: { title: '{sp} Boom', text: 'With too few hunters, {sp} multiplied fast and are eating the plants.' },
    disease: { title: 'Disease', text: 'Crowded {sp} spread a sickness; eating a sick one will poison you.' },
    barren: { title: 'Barren Land', text: 'The plants were eaten faster than they can regrow, so grazers are starving.' },
    surge: { title: 'Predator Surge', text: 'Plenty of prey drew in extra hunters, so more predators roam.' },
  };

  // ---------------------------------------------------------------- VALIDATION
  const BEHAVIORS = ['static', 'drift', 'wander', 'graze', 'hop', 'flit', 'swarm', 'school', 'herd', 'scurry',
    'flock', 'crawl', 'chase', 'stalk', 'ambush', 'pack', 'dive', 'charge'];
  const ROLES = ['producer', 'grazer', 'hunter'];
  const MISHAP_TYPES = ['famine', 'boom', 'disease', 'barren', 'surge'];
  const CFG_KEYS = ['PLAYER_BASE_R', 'PLAYER_SPEED', 'VIEW_R_MULT', 'EAT_RATIO', 'ENERGY_MAX', 'DASH_MULT', 'DASH_TIME',
    'DASH_CD', 'DASH_COST', 'LUNGE_MULT', 'WINDUP', 'LUNGE_TIME', 'RECOVER', 'STARVE_GRACE', 'COMBO_WINDOW',
    'HARMONY_BAND', 'PRODUCER_BAND', 'K_MULT', 'RG', 'HUNTER_STARVE', 'HUNTER_BREED_FED', 'SATIATED_TIME',
    'SPECIES_CAP_MULT', 'MAX_ENTITIES', 'MIGRATION_DELAY', 'RESPAWN_GROWTH', 'START_DNA', 'EVOLVE_DNA',
    'DNA_PER_MASS', 'PART_COSTS', 'DECOMPOSE_TIME', 'DECOMPOSE_SKIP', 'INTRO_TIME', 'GRACE', 'EVOLVE_TIME',
    'FINAL_HOLD', 'FINAL_HARMONY', 'WORLD', 'MISHAP_COOLDOWN', 'MAX_MISHAPS', 'MISHAP_SUSTAIN',
    'ARMOR_RECHARGE', 'POISON_TIME', 'AIR_ALT', 'HP_PER_MASS', 'BITE_CD', 'BITE_DMG', 'BITE_SNAP', 'BITE_SNAP_MUL',
    'BITE_ARC', 'BITE_REACH', 'BITE_JAWS_BONUS', 'FIGHT_RATIO', 'BIG_DMG_FRAC', 'PRED_DMG', 'PRED_INVULN',
    'FLINCH_FRAC', 'FLINCH_WINDOW', 'FLINCH_TIME', 'WOUND_FLEE', 'WOUND_RECOVER', 'REGEN', 'REGEN_DELAY',
    'REGEN_ENERGY', 'NPC_REGEN', 'NPC_REGEN_DELAY', 'NIP_DMG', 'NIP_CD', 'NIP_INVULN', 'ANGRY_TIME', 'ANGRY_SPEED',
    'ANGRY_BUMP_SPEED', 'ANGRY_LEASH', 'CARCASS_TIME', 'DECOY_TIME', 'TIP_TIME', 'TUT_BEETLE_DMG'];

  function checkCfg(out) {
    CFG_KEYS.forEach((k) => { if (A.CFG[k] === undefined) out.push('CFG missing ' + k); });
  }

  function checkSpecies(out) {
    Object.keys(A.SPECIES).forEach((id) => {
      const s = A.SPECIES[id];
      if (!s.name || !s.latin || !s.fact) out.push('species ' + id + ' missing name/latin/fact');
      Object.keys(s.innate || {}).forEach((p) => { if (!A.PARTS[p]) out.push('species ' + id + ' innate unknown part ' + p); });
      if (s.playable && !(s.ability && s.ability.id && s.ability.cd > 0)) out.push('species ' + id + ' playable without an ability');
    });
  }

  function checkRoster(t, out) {
    t.roster.forEach((e) => {
      if (!A.SPECIES[e.sp]) out.push(t.id + ' roster unknown species ' + e.sp);
      if (ROLES.indexOf(e.role) < 0) out.push(t.id + ' ' + e.sp + ' bad role ' + e.role);
      if (BEHAVIORS.indexOf(e.beh) < 0) out.push(t.id + ' ' + e.sp + ' bad beh ' + e.beh);
      if (e.role === 'producer' && e.beh !== 'static' && e.beh !== 'drift') out.push(t.id + ' producer ' + e.sp + ' must be static/drift');
      ['r', 'n0'].forEach((k) => { if (!(e[k] > 0)) out.push(t.id + ' ' + e.sp + ' bad ' + k); });
      if (typeof e.speed !== 'number') out.push(t.id + ' ' + e.sp + ' bad speed');
    });
    ROLES.forEach((role) => {
      if (!t.roster.some((e) => e.role === role)) out.push(t.id + ' has no ' + role);
    });
  }

  function checkTier(id, out) {
    const t = A.TIERS[id];
    if (t.id !== id) out.push(id + ' id mismatch');
    if (!A.PATHS[t.path]) out.push(id + ' unknown path ' + t.path);
    ['habitat', 'name', 'blurb', 'biome'].forEach((k) => { if (!t[k]) out.push(id + ' missing ' + k); });
    ['maxScale', 'growthNeeded', 'drain', 'world'].forEach((k) => { if (!(t[k] > 0)) out.push(id + ' bad ' + k); });
    (t.players || []).forEach((p) => {
      if (!A.SPECIES[p]) out.push(id + ' unknown player ' + p);
      else if (!A.SPECIES[p].playable) out.push(id + ' player ' + p + ' not playable');
    });
    if (!t.players || !t.players.length) out.push(id + ' has no players');
    (t.next || []).forEach((n) => { if (!A.TIERS[n]) out.push(id + ' dangling next ' + n); });
    if (t.prev && !A.TIERS[t.prev]) out.push(id + ' dangling prev ' + t.prev);
    if (t.final && (t.next || []).length) out.push(id + ' final but has next');
    if (!t.final && !(t.next || []).length) out.push(id + ' not final but has no next');
    MISHAP_TYPES.forEach((m) => {
      if (!t.mishaps || !t.mishaps[m] || !t.mishaps[m].title || !t.mishaps[m].text) out.push(id + ' missing mishap ' + m);
    });
    checkRoster(t, out);
  }

  A.validateConfig = function () {
    const out = [];
    checkCfg(out);
    checkSpecies(out);
    Object.keys(A.TIERS).forEach((id) => checkTier(id, out));
    if (!A.TIERS[A.TIER_START]) out.push('TIER_START unknown');
    Object.keys(A.PARTS).forEach((p) => {
      const d = A.PARTS[p];
      if (!d.name || !d.slot || !d.desc || !d.levels || d.levels.length !== 3 || !d.effect) out.push('part ' + p + ' incomplete');
    });
    Object.keys(A.PATHS).forEach((p) => {
      const d = A.PATHS[p];
      ['name', 'color', 'blurb', 'ending', 'cascade'].forEach((k) => { if (!d[k]) out.push('path ' + p + ' missing ' + k); });
    });
    MISHAP_TYPES.forEach((m) => { if (!A.MISHAP_DEFAULTS[m]) out.push('MISHAP_DEFAULTS missing ' + m); });
    return out;
  };
})();
