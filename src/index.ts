import {
  connect,
  OnTick,
  OnTickCurrentPlayer,
  TickHeartbeat,
} from "programming-game";
import { config } from "dotenv";
import fs from "fs";
import {
  Boots,
  Chests,
  Gloves,
  Helms,
  ItemDefinition,
  Items,
  Legs,
  WeaponType,
} from "programming-game/items";
import { recipes } from "programming-game/recipes";
import { spellMap } from "programming-game/spells";
import { weaponSkills } from "programming-game/weapon-skills";

import {
  heavilyEncumberedWeight,
  maxCalories,
  maxCarryWeight,
} from "programming-game/constants";
import {
  ClientSideNPC,
  ClientSidePlayer,
  ClientSideUnit,
  Intent,
  IntentType,
  NPC_IDS,
} from "programming-game/types";

config({
  path: ".env.mule",
});

const MAX_QUESTS = 5;
const MAIN_PLAYER_ID = "player_SvVKiOnygv9JfOmzCLdOU"; // Chickentuna
const MULE_PLAYER_ID = "player_OsOeqiE9JXevJZ8IHRt_m"; // Eldoradope

interface Context {
  player: OnTickCurrentPlayer;
  units: Record<string, ClientSideUnit>;
  items: Record<Items, ItemDefinition>;
  inArena: boolean;
  currentWeight: number;
  heartbeat: TickHeartbeat;
  isMule: boolean;
}

const assertEnv = (key: string): string => {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing env var ${key}, please check your .env file, you can get these values from https://programming-game.com/dashboard`
    );
  }
  return val;
};

let awaitFullHeal = false;

function reset() {
  prevTickActions = [];
  awaitFullHeal = false;
}

function getCurrentWeight(
  inventory: Partial<Record<Items, number>>,
  items: Record<Items, ItemDefinition>
) {
  let total = 0;
  for (const [itemKey, itemCount] of Object.entries(inventory)) {
    const item = items[itemKey as Items];
    total += item.weight * itemCount!;
  }
  return total;
}

function getTickAction(heartbeat: TickHeartbeat): Intent | void {
  const { player, units, items } = heartbeat;
  if (!player) return;

  const inArena = heartbeat.inArena;
  const currentWeight = getCurrentWeight(player.inventory, items);
  const context: Context = {
    player,
    units,
    items,
    inArena,
    heartbeat,
    currentWeight,
    isMule: process.env.IS_MULE === "true",
  };
  let a: Intent | void;

  if (!inArena) {
    a = doRespawn(context);
    if (a) return a;

    checkHealth(context);

    a = doEat(context) ?? doRegenTP(context) ?? doEquipItems(context);
    if (a) return a;
    if (isAtSpawn(context)) {
      recordNPCData(context);
      a =
        doBank(context) ??
        doQuests(context) ??
        doSellTrash(context) ??
        doBuyItems(context) ??
        doCraftItems(context);
      if (a) return a;
    }
    checkHealth(context);

    a =
      doSetSpellStones(context) ??
      doDropExcessItems(context) ??
      doEscapeToSpawn(context);
      
    if (a) return a;
  }
  a = doHunt(context) ?? /*doTrade(context) ??*/ doGoToWilderness(context);
  if (a) return a;
}


function doBank({ player, units, items, isMule }: Context): Intent | void {
  if (player.inventory.copperCoin! >= 30000) {
    let banker = Object.values(units).find(unit => {
      return unit.type === 'npc' && unit.banker;
    });
    if (!banker) {
      return;
    }
    banker = banker as ClientSideNPC;
    
    return player.deposit(banker, {"copperCoin": 30000});
  }
}

function count(obj: any): number {
  return Object.keys(obj).length;
}
function every<T>(obj: Record<string, T>): T[] {
  return obj == null ? [] : Object.values(obj);
}

let NPC_DATA: ClientSideNPC[] = [];

function recordNPCData({ isMule, units }: Context) {
  if (!isMule) {
    return;
  }

  const npcs = every(units).filter((u) => u.npc) as ClientSideNPC[];
  if (JSON.stringify(npcs) === JSON.stringify(NPC_DATA)) {
    return;
  }
  // write to file
  fs.writeFileSync("npcs.json", JSON.stringify(npcs, null, 2), "utf-8");
  NPC_DATA = npcs;
  console.log("NPC data saved to npcs.json");
}

// Don't do quests for now
function doQuests({ player, units, items, isMule }: Context): Intent | void {
  if (isMule || true) {
    // Abandon quests
    for (const quest of every(player.quests)) {
      return player.abandonQuest(quest.id);
    }
    return 
  }
  /*
  // Turn in quests
  for (const quest of every(player.quests)) {
    let stepIdx = 0;
    while (stepIdx < quest.steps.length) {
      const nextStep = quest.steps[stepIdx++];

      if (nextStep.type === "turn_in") {
        if (!nextStep.requiredItems) {
          const endNpc = nextStep.target;
          return player.turnInQuest({ id: endNpc } as ClientSideNPC, quest.id);
        }
        let enoughItems = true;
        for (const [item, needs] of Object.entries(nextStep.requiredItems)) {
          let count = player.inventory[item as Items] ?? 0;
          if (count < (needs ?? 0)) {
            enoughItems = false;
            break;
          }
        }
        if (enoughItems) {
          const endNpc = nextStep.target;
          return player.turnInQuest({ id: endNpc } as ClientSideNPC, quest.id);
        }
      } else if (nextStep.type === "kill") {
        // Requirement fulfilled?
        let allKilled = true;
        for (const [target, counter] of Object.entries(nextStep.targets)) {
          if (counter.killed < counter.required) {
            allKilled = false;
            break;
          }
        }
        if (!allKilled) {
          break; // break out of the while loop, we need to kill more
        }
      }
    }
  }

  // Accept some quests
  if (count(player.quests) < MAX_QUESTS) {
    const npcs = every(units).filter((u) => u.npc) as ClientSideNPC[];
    for (const npc of npcs) {
      for (const quest of every(npc.availableQuests)) {
        if (!player.quests[quest.id]) {
          return player.acceptQuest(npc, quest.id);
        }
      }
    }
  }
  */
}

function doRegenTP({ player, heartbeat }: Context): Intent | void {
  if (player.tp < 100 && player.hp >= 100) {
    // Hit myself unarmed to regen TP
    return player.attack(player);
  }
}

/*
function doTrade({ player, isMule, units, items }: Context): Intent | void {
  // start sending money to main in enough at least 300 coins
  if (isMule && player.inventory.copperCoin! >= 300) {
    // Is Chickentuna in vicinity?
    const chickentuna = units[MAIN_PLAYER_ID];
    if (chickentuna) {
      if (!player.trades.offers.feather) {
        return player.setTrade({
          wants: {
            feather: 300,
          },
          offers: {
            feather: 0,
          },
        });
      }

      // Follow him
      return player.move({
        x: chickentuna.position.x,
        y: chickentuna.position.y,
      });
    } else {
      // Approach him
      return player.attack(MAIN_PLAYER_ID);
    }
  } else if (isMule) {
    // Not enough coin
    if (player.trades.offers.feather) {
      return player.setTrade({
        wants: {
          feather: 0,
        },
        offers: {
          feather: 0,
        },
      });
    }
  } else {
    // Is Eldoradope in vicinity?
    const mule = units[MULE_PLAYER_ID];
    if (mule && mule.trades.wants.feather && player.inventory.feather! >= 1) {
      return player.sell("feather", 0, MULE_PLAYER_ID);
    }
  }
}
*/

function doCraftItems({ player, items, isMule }: Context): Intent | void {
  if (isMule) {
    return;
  }

  const wishList: { id: CopperArmor; type: "armor" }[] = [
    { id: "copperMailHelm", type: "armor" },
    { id: "copperMailChest", type: "armor" },
    { id: "copperMailBoots", type: "armor" },
    { id: "copperMailGloves", type: "armor" },
    { id: "copperMailLegs", type: "armor" },
    // ,    {id: "copperGreatSword", type: 'weapon'}
  ];
  for (const wish of wishList) {
    const type = items[wish.id].type as ArmorType;

    if (player.inventory.anvil && player.inventory.furnace) {
      if (player.inventory[wish.id]) {
        continue; // Already have this item
      }
      if (wish.type === "armor" && player.equipment[type as ArmorType]) {
        continue; // Already have this armor piece equipped
      }
      // if (wish.type === 'weapon' && player.equipment.hands) {
      //   continue; // Already have this weapon equipped
      // }

      // Craft wished if we have enough copper coins
      let ingotsPerWished = recipes[wish.id].input.copperIngot;
      let chunksPerIngot = recipes.copperIngot.input.chunkOfCopper;
      let coinsPerChunk = recipes.chunkOfCopper.input.copperCoin;
      let totalCoinsNeeded = ingotsPerWished * chunksPerIngot * coinsPerChunk;
      totalCoinsNeeded -=
        (player.inventory.copperIngot ?? 0) * chunksPerIngot * coinsPerChunk;
      totalCoinsNeeded -= (player.inventory.chunkOfCopper ?? 0) * coinsPerChunk;

      if ((player.inventory.copperCoin ?? 0) >= totalCoinsNeeded) {
        if ((player.inventory.copperIngot ?? 0) >= ingotsPerWished) {
          return player.craft(wish.id, {
            copperIngot: ingotsPerWished,
          });
        }
        if ((player.inventory.chunkOfCopper ?? 0) >= chunksPerIngot) {
          return player.craft("copperIngot", { chunkOfCopper: chunksPerIngot });
        }
        if ((player.inventory.copperCoin ?? 0) >= coinsPerChunk) {
          return player.craft("chunkOfCopper", { copperCoin: coinsPerChunk });
        }
      }
    }
  }
}

function doRespawn({ player, heartbeat }: Context): Intent | void {
  if (player.hp <= 0) {
    console.log("I died on:", new Date().toISOString());
    console.log("Calories:", player.calories);
    console.log("Coins lost:", player.inventory.copperCoin ?? 0);
    console.log("history:");
    // reverse history:
    prevTickActions.reverse();
    for (const action of prevTickActions) {
      console.log(action, "\ttp=", player.tp, "\thp=", player.hp);
    }

    reset();
    return player.respawn();
  }
}

function checkHealth({ player, ...context }: Context) {
  if (player.hp < 45) {
    awaitFullHeal = true;
  }

  // Fully healed or healed enough to battle on
  if (
    player.hp >= 100 ||
    (!isAtSpawn({ player, ...context }) && player.hp >= 75)
  ) {
    awaitFullHeal = false;
  }
}

function doEat({ player, items }: Context): Intent | void {
  for (const itemKey of Object.keys(player.inventory)) {
    const item = items[itemKey as Items];
    const itemCount = player.inventory[itemKey as Items] ?? 0;
    if (
      itemCount > 0 &&
      item.type === "food" &&
      item.calories! <= maxCalories - player.calories
    ) {
      return player.eat(item.id);
    }
  }
}

function isAtSpawn({ player }: Context) {
  let distanceToZero = Math.sqrt(
    player.position.x ** 2 + player.position.y ** 2
  );
  return distanceToZero < 3;
}

function isCoin(item: ItemDefinition): boolean {
  return item.name.toLowerCase().includes("coin");
}

function doSellTrash({ player, items, units }: Context): Intent | void {
  for (const itemKey of Object.keys(player.inventory)) {
    const item = items[itemKey as Items];
    const itemCount = player.inventory[itemKey as Items] ?? 0;
    if (
      itemCount > 0 &&
      ["trash", "food"].includes(item.type) &&
      !isCoin(item) &&
      !["furnace", "chunkOfCopper", "copperIngot", "anvil"].includes(item.id)
    ) {
      return player.sell({
        items: {[item.id]: itemCount},
        to: units[NPC_IDS.healer_name]
      });
    }
  }
}

type CopperArmor =
  | "copperMailHelm"
  | "copperMailChest"
  | "copperMailBoots"
  | "copperMailGloves"
  | "copperMailLegs";
// type CopperWeapon = "copperSword" | "copperGreatSword";

type ArmorType = "helm" | "chest" | "legs" | "feet" | "hands";

function doEquipItems({ player, items }: Context): Intent | void {
  const wishList: CopperArmor[] = [
    "copperMailHelm",
    "copperMailChest",
    "copperMailBoots",
    "copperMailGloves",
    "copperMailLegs",
  ];
  for (const wish of wishList) {
    const type = items[wish].type as ArmorType;
    if (!player.equipment[type] && (player.inventory[wish] ?? 0) > 0) {
      return player.equip(wish, type);
    }
  }
  if ((player.inventory.copperGreatSword ?? 0) > 0) {
    return player.equip("copperGreatSword", "weapon");
  }
  if (!player.equipment.weapon && (player.inventory.copperSword ?? 0) > 0) {
    return player.equip("copperSword", "weapon");
  }
  if (!player.equipment.offhand && (player.inventory.woodenShield ?? 0) > 0) {
    return player.equip("woodenShield", "offhand");
  }
}

function doBuyItems({ player, items, isMule, units}: Context): Intent | void {
  if (isMule) {
    if (
      !player.equipment.weapon &&
      player.inventory.basicGrimmoire! >=
        items.basicGrimmoire.buyFromVendorPrice
    ) {
      return player.buy({items: {"basicGrimmoire": 1}, from: units[NPC_IDS["healer_name"]]});
    }
    if (
      !player.equipment.weapon &&
      player.inventory.minorManaRing! >= items.minorManaRing.buyFromVendorPrice
    ) {
      return player.buy({items: {"minorManaRing": 1}, from: units[NPC_IDS["healer_name"]]});
    }
    return;
  }

  if (
    !player.equipment.weapon &&
    player.inventory.copperCoin! >= items.copperSword.buyFromVendorPrice
  ) {
    return player.buy({items: {"copperSword": 1}, from: units[NPC_IDS["guard_name"]]});
  }

  if (
    !player.equipment.offhand &&
    player.inventory.copperCoin! >= items.woodenShield.buyFromVendorPrice
  ) {
    return player.buy({items: {"woodenShield": 1}, from: units[NPC_IDS["healer_name"]]});
  }
  if (
    !player.inventory.furnace &&
    player.inventory.copperCoin! >= items.furnace.buyFromVendorPrice
  ) {
    return player.buy({items: {"furnace": 1}, from: units[NPC_IDS["healer_name"]]});
  }
  if (
    !player.inventory.anvil &&
    player.inventory.copperCoin! >= items.anvil.buyFromVendorPrice
  ) {
    return player.buy({items: {"anvil": 1}, from: units[NPC_IDS["healer_name"]]});
  }
}

function doSetSpellStones({ player, isMule, items }: Context): Intent | void {
  if (!isMule) {
    return;
  }

  if (
    (player.equipment.hands?.includes("basicGrimmoire") ||
      player.inventory.basicGrimmoire) &&
    player.inventory.aid_digestion! > 0
  ) {
    return player.setSpellStones(
      "basicGrimmoire",
      ["aid_digestion"],
      "Digestion Tome"
    );
  }
}

function doDropExcessItems({ player, isMule, items }: Context): Intent | void {
  const itemKeys = Object.keys(player.inventory);
  const currentWeight = getCurrentWeight(player.inventory, items);
  if (currentWeight >= maxCarryWeight) {
    for (const itemKey of itemKeys) {
      const item = items[itemKey as Items];
      if (
        ["trash", "food"].includes(item.type) &&
        !isCoin(item)
      ) {
        return player.drop({item: item.id, amount: player.inventory[item.id]!});
      }
    }
  }

  if (player.inventory.copperCoin! >= 30000) {
    // I'm full, I will die of hunger soon
    return player.drop({item: "copperCoin", amount:  20000});
  }

  if (isMule) {
    if (player.inventory["aid_digestion"]! > 1) {
      return player.drop({item: "aid_digestion", amount: 1});
    }
  }

  if (player.inventory["aid_digestion"]) {
    return player.drop({item: "aid_digestion", amount: 1});
  }
}

function doEscapeToSpawn({ player, currentWeight }: Context): Intent | void {
  if (awaitFullHeal || currentWeight >= heavilyEncumberedWeight + 10_000) {
    return player.move({ x: 0, y: 0 });
  }
}

function doHunt({
  inArena,
  player,
  units,
  items,
  isMule,
  heartbeat,
}: Context): Intent | void {
  for (const [k, v] of Object.entries(units)) {
    if (v.hp <= 0) {
      continue; // Skip dead units
    }
    if (v.id === player.id) {
      continue; // Skip self
    }
    const attackingMe =
      v.intent?.type === IntentType.attack && v.intent.target === player.id;

    if (inArena || v.type === "monster" || attackingMe) {
      if (
        !player.equipment.weapon &&
        player.tp >= weaponSkills.haymaker.tpCost
      ) {
        return player.useWeaponSkill({skill: "haymaker", target: v});
      }

      if (
        items[player.equipment.weapon!]?.type === "oneHandedSword" &&
        player.tp >= weaponSkills.doubleSlash.tpCost
      ) {
        return player.useWeaponSkill({skill: "doubleSlash", target: v});
      }

      return player.attack(v);
    }
  }
}

function doGoToWilderness({ player, isMule }: Context): Intent | void {
  if (player.equipment.weapon && player.equipment.offhand) {
    return player.move({ x: 40, y: 0 });
  }

  if (isMule) {
    return player.move({ x: -30, y: 0 });
  }

  return player.move({ x: 50, y: 0 });
}

let prevTickActions: (Intent | "none")[] = [];
const HISTORY_LENGTH = 10;

connect({
  credentials: {
    id: assertEnv("USER_ID"),
    key: assertEnv("API_KEY"),
  },
  onTick(heartbeat) {
    const action = getTickAction(heartbeat);

    if (!heartbeat.inArena) {
      const lastAction = prevTickActions[0];
      if (isDifferent(action, lastAction)) {
        console.log(
          action,
          "\ttp=",
          heartbeat.player.tp,
          "\thp=",
          Math.round(heartbeat.player.hp)
        );
        prevTickActions = [
          action ?? "none",
          ...prevTickActions.slice(0, HISTORY_LENGTH - 1),
        ];
      }
    }

    return action;
  },
  onEvent(instance, charId, eventName, evt) {
    //   og(`Event received from ${instance} for ${charId}: ${eventName}`, evt);
  },
});

function isDifferent(a: any, b: any): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// bZ2tKP4cfGvWx6WGvco-2 is greg
// Z4KF5LPvsJsCDWNuZRkZN is Tyr
// QztHfF0s9_NUlRwD68Kim is Hmmmm?
// player_SvVKiOnygv9JfOmzCLdOU is me
// player_OsOeqiE9JXevJZ8IHRt_m is mule
