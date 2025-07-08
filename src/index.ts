import {
  connect,
  OnTick,
  OnTickCurrentPlayer,
  TickHeartbeat,
} from "programming-game";
import { config } from "dotenv";
import {
  Boots,
  Chests,
  Gloves,
  Helms,
  ItemDefinition,
  Items,
  Legs,
} from "programming-game/items";
import { recipes } from "programming-game/recipes";
import { spellMap } from "programming-game/spells";
import { weaponSkills } from "programming-game/weapon-skills";

import { offers } from "./offers";
import {
  heavilyEncumberedWeight,
  maxCalories,
  maxCarryWeight,
} from "programming-game/constants";
import {
  ClientSidePlayer,
  ClientSideUnit,
  Intent,
  IntentType,
} from "programming-game/types";

config({
  path: ".env",
});

interface Context {
  player: OnTickCurrentPlayer;
  units: Record<string, ClientSideUnit>;
  items: Record<Items, ItemDefinition>;
  myItems: Items[];
  inArena: boolean;
  currentWeight: number;
  heartbeat: TickHeartbeat;
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
  const myItems = Object.keys(player.inventory) as Items[];
  const inArena = heartbeat.inArena;
  const currentWeight = getCurrentWeight(player.inventory, items);
  const context: Context = {
    player,
    units,
    items,
    myItems,
    inArena,
    heartbeat,
    currentWeight,
  };
  let a: Intent | void;

  if (!inArena) {
    a = doRespawn(context);
    if (a) return a;
    doCheckHealth(context);
    a = doEat(context);
    if (a) return a;
    if (isAtSpawn(context)) {
      a = doSellTrash(context);
      if (a) return a;
      a = doEquipItems(context);
      if (a) return a;
      a = doBuyItems(context);
      if (a) return a;
      a = doCraftItems(context);
      if (a) return a;
    }
    doCheckHealth(context);
    a = doDropExcessItems(context);
    if (a) return a;
    a = doEscapeToSpawn(context);
    if (a) return a;
  }
  a = doHunt(context);
  if (a) return a;
  a = doGoToWilderness(context);
  if (a) return a;
}

function doCraftItems({ player, items, myItems }: Context): Intent | void {
  const wishList: CopperArmor[] = [
    "copperMailHelm",
    "copperMailChest",
    "copperMailBoots",
    "copperMailGloves",
    "copperMailLegs",
  ];
  for (const wish of wishList) {
    const type = items.copperMailChest.type as ArmorType;

    if (
      !player.equipment[type] &&
      myItems.includes("anvil") &&
      myItems.includes("furnace")
    ) {
      // Craft wished if we have enough copper coins
      let ingotsPerWished = recipes[wish].input.copperIngot;
      let chunksPerIngot = recipes.copperIngot.input.chunkOfCopper;
      let coinsPerChunk = recipes.chunkOfCopper.input.copperCoin;
      let totalCoinsNeeded = ingotsPerWished * chunksPerIngot * coinsPerChunk;
      totalCoinsNeeded -=
        (player.inventory.copperIngot ?? 0) * chunksPerIngot * coinsPerChunk;
      totalCoinsNeeded -= (player.inventory.chunkOfCopper ?? 0) * coinsPerChunk;

      if ((player.inventory.copperCoin ?? 0) >= totalCoinsNeeded) {
        if ((player.inventory.copperIngot ?? 0) > ingotsPerWished) {
          return player.craft(wish, {
            copperIngot: ingotsPerWished,
          });
        }
        if ((player.inventory.chunkOfCopper ?? 0) > chunksPerIngot) {
          return player.craft("copperIngot", { chunkOfCopper: chunksPerIngot });
        }
        if ((player.inventory.copperIngot ?? 0) > coinsPerChunk) {
          return player.craft("copperIngot", { copperCoin: coinsPerChunk });
        }
      }
    }
  }
}

function doRespawn({ player }: Context): Intent | void {
  if (player.hp <= 0) {
    console.log("I died on:", new Date().toISOString());
    reset();
    return player.respawn();
  }
}

function doCheckHealth({ player }: Context) {
  if (player.hp < 30) {
    awaitFullHeal = true;
  }
  if (player.hp >= 100) {
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
      return player.eat(item.id, itemCount - 1);
    }
  }
}

function isAtSpawn({ player }: Context) {
  let distanceToZero = Math.sqrt(
    player.position.x ** 2 + player.position.y ** 2
  );
  return distanceToZero < 3;
}

function doSellTrash({ player, items }: Context): Intent | void {
  for (const itemKey of Object.keys(player.inventory)) {
    const item = items[itemKey as Items];
    const itemCount = player.inventory[itemKey as Items] ?? 0;
    if (
      itemCount > 0 &&
      ["trash", "food"].includes(item.type) &&
      !item.name.includes("coin") &&
      item.id != "furnace" &&
      item.id != "chunkOfCopper" &&
      item.id != "copperIngot" &&
      item.id != "anvil"
    ) {
      return player.sell(item.id, 0, "healer_name");
    }
  }
}

type CopperArmor =
  | "copperMailHelm"
  | "copperMailChest"
  | "copperMailBoots"
  | "copperMailGloves"
  | "copperMailLegs";

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
  if (!player.equipment.weapon && (player.inventory.copperSword ?? 0) > 0) {
    return player.equip("copperSword", "weapon");
  }
  if (!player.equipment.offhand && (player.inventory.woodenShield ?? 0) > 0) {
    return player.equip("woodenShield", "offhand");
  }
}

function doBuyItems({ player }: Context): Intent | void {
  if (
    !player.equipment.weapon &&
    player.inventory.copperCoin! >= offers.guard_name.copperSword
  ) {
    return player.buy("copperSword", 1, "guard_name");
  }
  if (
    !player.equipment.offhand &&
    player.inventory.copperCoin! >= offers.healer_name.woodenShield
  ) {
    return player.buy("woodenShield", 1, "healer_name");
  }
  if (
    !player.inventory.furnace &&
    player.inventory.copperCoin! >= offers.healer_name.furnace
  ) {
    return player.buy("furnace", 1, "healer_name");
  }
  if (
    !player.inventory.anvil &&
    player.inventory.copperCoin! >= offers.healer_name.anvil
  ) {
    return player.buy("anvil", 1, "healer_name");
  }
}

function doDropExcessItems({ player, items }: Context): Intent | void {
  const itemKeys = Object.keys(player.inventory);
  const currentWeight = getCurrentWeight(player.inventory, items);
  if (currentWeight >= maxCarryWeight) {
    for (const itemKey of itemKeys) {
      const item = items[itemKey as Items];
      if (
        ["trash", "food"].includes(item.type) &&
        !item.name.includes("coin")
      ) {
        return player.drop(item.id, 0);
      }
    }
  }
}

function doEscapeToSpawn({ player, currentWeight }: Context): Intent | void {
  if (awaitFullHeal || currentWeight >= heavilyEncumberedWeight) {
    return player.move({ x: 0, y: 0 });
  }
}

function doHunt({ player, units, items, heartbeat }: Context): Intent | void {
  for (const [k, v] of Object.entries(units)) {
    if (
      v.type === "monster" ||
      (v.intent?.type === IntentType.attack && v.intent.target === player.id)
    ) {
      if (!player.equipment.weapon && player.tp >= weaponSkills.combo.tpCost) {
        return player.useWeaponSkill("combo", k);
      }

      if (
        items[player.equipment.weapon!]?.type === "oneHandedSword" &&
        player.tp >= weaponSkills.doubleSlash.tpCost
      ) {
        return player.useWeaponSkill("doubleSlash", k);
      }

      return player.attack(k);
    }
  }
}

function doGoToWilderness({ player, ...context }: Context): Intent | void {
    if (player.equipment.weapon && player.equipment.offhand) {
      return player.move({ x: 400, y: 0 });
    }
    return player.move({ x: 40, y: 0 });
}

let prevTickAction: Intent | void;

connect({
  credentials: {
    id: assertEnv("USER_ID"),
    key: assertEnv("API_KEY"),
  },
  onTick(heartbeat) {
    const action = getTickAction(heartbeat);
    return action;
  },
  onEvent(instance, charId, eventName, evt) {
    //   console.log(`Event received from ${instance} for ${charId}: ${eventName}`, evt);
  },
});

// bZ2tKP4cfGvWx6WGvco-2 is greg
// Z4KF5LPvsJsCDWNuZRkZN is Tyr
// QztHfF0s9_NUlRwD68Kim is Hmmmm?
// player_SvVKiOnygv9JfOmzCLdOU is me
