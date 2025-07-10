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
  path: ".env.mule",
});

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

    a = doEat(context);
    if (a) return a;
    if (isAtSpawn(context)) {
      a =
        doSellTrash(context) ??
        doEquipItems(context) ??
        doBuyItems(context) ??
        doCraftItems(context);
      if (a) return a;
    }
    checkHealth(context);

    a = doDropExcessItems(context) ?? doEscapeToSpawn(context);
    if (a) return a;
  }
  a = doHunt(context) ?? doTrade(context);
  if (a) return a;
  a = doGoToWilderness(context);
  if (a) return a;
}

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

function doCraftItems({ player, items, isMule }: Context): Intent | void {
  if (isMule) {
    return;
  }

  const wishList: CopperArmor[] = [
    "copperMailHelm",
    "copperMailChest",
    "copperMailBoots",
    "copperMailGloves",
    "copperMailLegs",
  ];
  for (const wish of wishList) {
    const type = items[wish].type as ArmorType;

    if (
      !player.equipment[type] &&
      player.inventory.anvil &&
      player.inventory.furnace
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
        console.log("lets craft", wish);
        if ((player.inventory.copperIngot ?? 0) >= ingotsPerWished) {
          return player.craft(wish, {
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
      (["trash", "food"].includes(item.type) ||
        (player.equipment.feet && item.type === "feet")) &&
      !item.name.includes("coin") &&
      !["furnace", "chunkOfCopper", "copperIngot", "anvil"].includes(item.id)
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

  // For the mule
  if (!player.equipment.weapon && (player.inventory.woodenArrow ?? 0) > 0) {
    return player.equip("woodenBow", "weapon");
  }
}

function doBuyItems({ player, items, isMule }: Context): Intent | void {
  if (isMule) {
    if (
      !player.equipment.weapon &&
      player.inventory.copperCoin! >= items.copperSword.buyFromVendorPrice
    ) {
      return player.buy("copperSword", 1, "guard_name");
    }
    // if (
    //   !player.equipment.weapon &&
    //   player.inventory.copperCoin! >= items.woodenArrow.buyFromVendorPrice * 100
    // ) {
    //   return player.buy("woodenArrow", 100, "healer_name");
    // }
    // if (
    //   !player.equipment.weapon &&
    //   player.inventory.copperCoin! >= items.woodenBow.buyFromVendorPrice
    // ) {
    //   return player.buy("woodenBow", 1, "healer_name");
    // }
    return;
  }

  if (
    !player.equipment.weapon &&
    player.inventory.copperCoin! >= items.copperSword.buyFromVendorPrice
  ) {
    return player.buy("copperSword", 1, "guard_name");
  }

  if (
    !player.equipment.offhand &&
    player.inventory.copperCoin! >= items.woodenShield.buyFromVendorPrice
  ) {
    return player.buy("woodenShield", 1, "healer_name");
  }
  if (
    !player.inventory.furnace &&
    player.inventory.copperCoin! >= items.furnace.buyFromVendorPrice
  ) {
    return player.buy("furnace", 1, "healer_name");
  }
  if (
    !player.inventory.anvil &&
    player.inventory.copperCoin! >= items.anvil.buyFromVendorPrice
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
  if (player.inventory["aid_digestion"]) {
    return player.drop("aid_digestion", 0);
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
        return player.useWeaponSkill("haymaker", k);
      }

      if (
        items[player.equipment.weapon!]?.type === "oneHandedSword" &&
        player.tp >= weaponSkills.doubleSlash.tpCost
      ) {
        // In case of server desync, use skill only 90% of the times
        if (Math.random() < 0.9) {
          return player.useWeaponSkill("doubleSlash", k);
        }
      }

      return player.attack(k);
    }
  }
}

function doGoToWilderness({ player, isMule }: Context): Intent | void {
  if (player.equipment.weapon && player.equipment.offhand) {
    return player.move({ x: 35, y: 0 }); // 35 because Tyr is stuck, we can ninja all his loot
  }

  if (isMule) {
    return player.move({ x: -30, y: 0 });
  }

  return player.move({ x: 50, y: 0 });
}

let prevTickAction: Intent | void | null = null;

connect({
  credentials: {
    id: assertEnv("USER_ID"),
    key: assertEnv("API_KEY"),
  },
  onTick(heartbeat) {
    const action = getTickAction(heartbeat);
    if (!heartbeat.inArena) {
      if (isDifferent(action, prevTickAction)) {
        console.log(
          action,
          "tp=",
          heartbeat.player.tp,
          "hp=",
          heartbeat.player.hp,
          // 'lastAction=',
          // heartbeat.player.lastAction, heartbeat.player.lastUpdate
        );
      }
      prevTickAction = action;
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
