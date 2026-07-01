(() => {
  const data = window.D2_ARMOR_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const STAT_ORDER = ["weapons", "health", "grenade", "super", "class", "melee"];
  const SLOT_ORDER = ["helmet", "gauntlets", "chest", "legs", "classItem"];
  const SLOT_MARK = { helmet: "H", gauntlets: "A", chest: "C", legs: "L", classItem: "I" };
  const STAT_MARK = { weapons: "W", health: "H", grenade: "G", super: "S", class: "C", melee: "M" };
  const STAT_ALIASES = { weapon: "weapons", weapons: "weapons", health: "health", grenade: "grenade", super: "super", class: "class", melee: "melee" };
  const TIER_PRESETS = {
    1: { primary: 22, secondary: 18, tertiary: 15, label: "T1 估算" },
    2: { primary: 24, secondary: 20, tertiary: 18, label: "T2 估算" },
    3: { primary: 26, secondary: 22, tertiary: 18, label: "T3 估算" },
    4: { primary: 28, secondary: 24, tertiary: 20, label: "T4 估算" },
    5: { primary: 30, secondary: 25, tertiary: 20, label: "T5" },
  };

  const setByHash = new Map(data.sets.map((set) => [String(set.hash), set]));
  const archByHash = new Map(data.archetypes.map((arch) => [String(arch.hash), arch]));
  const modByHash = new Map(data.armorMods.map((mod) => [String(mod.hash), mod]));
  const exoticByHash = new Map(data.exoticArmor.map((item) => [String(item.hash), item]));
  const statById = new Map(data.stats.map((stat) => [stat.id, stat]));

  const state = {
    activeTab: "builder",
    klass: "hunter",
    community: true,
    setSearch: "",
    setCategory: "all",
    exoticSearch: "",
    exoticSlot: "all",
    modSearch: "",
    modSlot: "all",
    modType: "all",
    gear: {},
    drag: null,
    suppressClick: false,
  };

  const text = (value) => value?.zh || value?.en || "";
  const english = (value) => value?.en || value?.zh || "";
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const statName = (id) => text(statById.get(id)?.name) || id;
  const slotLabel = (slot) => data.labels.slots[slot] || slot;
  const classLabel = (klass) => data.labels.classes[klass] || klass;
  const modCost = (mod) => Math.max(...(mod?.energyVariants || [mod?.energy || 0]));
  const modEnergyLabel = (mod) => (mod?.energyVariants?.length > 1 ? mod.energyVariants.join("/") : String(mod?.energy || 0));

  function getDefaultArchetype() {
    return data.archetypes.find((arch) => english(arch.name) === "Gunner") || data.archetypes[0];
  }

  function initGear() {
    const arch = getDefaultArchetype();
    for (const slot of SLOT_ORDER) {
      state.gear[slot] = {
        setHash: String(data.sets[0]?.hash || ""),
        exoticHash: "",
        archetypeHash: String(arch.hash),
        tier: 5,
        masterwork: 5,
        tertiary: legalTertiary(arch),
        tuned: arch.primary,
        tuningMode: "",
        attrModHash: "",
        functionMods: ["", "", ""],
      };
    }
  }

  function emptyStats() {
    return Object.fromEntries(STAT_ORDER.map((id) => [id, 0]));
  }

  function addStats(target, source) {
    for (const id of STAT_ORDER) target[id] += Number(source?.[id] || 0);
  }

  function legalTertiary(arch, current) {
    const blocked = new Set([arch.primary, arch.secondary]);
    if (current && !blocked.has(current)) return current;
    return STAT_ORDER.find((id) => !blocked.has(id)) || STAT_ORDER[0];
  }

  function normalizeGear(slot) {
    const cfg = state.gear[slot];
    const arch = archByHash.get(String(cfg.archetypeHash)) || getDefaultArchetype();
    cfg.tertiary = legalTertiary(arch, cfg.tertiary);
    if (!STAT_ORDER.includes(cfg.tuned)) cfg.tuned = arch.primary;
    if (Number(cfg.tier) < 5) cfg.tuningMode = "";
    if (cfg.tuningMode?.startsWith("drain:") && cfg.tuningMode.slice(6) === cfg.tuned) cfg.tuningMode = "";
    const exotic = cfg.exoticHash ? exoticByHash.get(String(cfg.exoticHash)) : null;
    if (exotic && (exotic.class !== state.klass || exotic.slot !== slot)) cfg.exoticHash = "";
    if (!Array.isArray(cfg.functionMods)) cfg.functionMods = ["", "", ""];
  }

  function lowestStats(stats, count) {
    return STAT_ORDER.map((id) => ({ id, value: stats[id] }))
      .sort((a, b) => a.value - b.value || STAT_ORDER.indexOf(a.id) - STAT_ORDER.indexOf(b.id))
      .slice(0, count)
      .map((entry) => entry.id);
  }

  function statModEffect(mod) {
    const match = /^(Minor )?(Weapons|Weapon|Health|Grenade|Super|Class|Melee) Mod$/i.exec(english(mod?.name || {}));
    if (!match) return null;
    const stat = STAT_ALIASES[match[2].toLowerCase()];
    return { stat, value: match[1] ? 5 : 10 };
  }

  function isStatMod(mod) {
    return Boolean(statModEffect(mod));
  }

  function isHiddenMod(mod) {
    const name = english(mod.name);
    return !name || /^Locked Armor Mod$/i.test(name);
  }

  function fontStatFromMod(mod) {
    const match = /^(Weapons|Health|Grenade|Super|Class|Melee) Font$/i.exec(english(mod?.name || {}));
    return match ? STAT_ALIASES[match[1].toLowerCase()] : null;
  }

  function surgeName(mod) {
    const name = english(mod?.name || {});
    return /Weapon Surge$/i.test(name) ? name : null;
  }

  function compatibleFunctionMod(mod, slot) {
    return !isStatMod(mod) && (mod.slot === slot || mod.slot === "general");
  }

  function modFitsSocket(mod, type, slot) {
    if (!mod || isHiddenMod(mod)) return false;
    if (type === "attr") return isStatMod(mod);
    if (type === "function") return compatibleFunctionMod(mod, slot);
    return false;
  }

  function tuningOptionsFor(slot) {
    const cfg = state.gear[slot];
    const baseLabel = Number(cfg.tier) < 5 ? "T5 才可 tuning" : "不使用";
    return [
      ["", baseLabel],
      ["balanced", "Balanced +1 最低三项"],
      ...STAT_ORDER.filter((id) => id !== cfg.tuned).map((id) => [`drain:${id}`, `+${statName(cfg.tuned)} / -${statName(id)}`]),
    ];
  }

  function calculatePiece(slot) {
    normalizeGear(slot);
    const cfg = state.gear[slot];
    const arch = archByHash.get(String(cfg.archetypeHash)) || getDefaultArchetype();
    const preset = TIER_PRESETS[cfg.tier] || TIER_PRESETS[5];
    const values = emptyStats();
    values[arch.primary] += preset.primary;
    values[arch.secondary] += preset.secondary;
    values[cfg.tertiary] += preset.tertiary;

    for (const id of lowestStats(values, 3)) values[id] += Number(cfg.masterwork || 0);

    if (Number(cfg.tier) >= 5) {
      if (cfg.tuningMode === "balanced") {
        for (const id of lowestStats(values, 3)) values[id] += 1;
      } else if (cfg.tuningMode?.startsWith("drain:")) {
        const drain = cfg.tuningMode.slice(6);
        if (drain !== cfg.tuned) {
          values[cfg.tuned] += 5;
          values[drain] = Math.max(0, values[drain] - 5);
        }
      }
    }

    const attrMod = cfg.attrModHash ? modByHash.get(String(cfg.attrModHash)) : null;
    const effect = statModEffect(attrMod);
    if (effect) values[effect.stat] += effect.value;
    return values;
  }

  function allFunctionMods() {
    return SLOT_ORDER.flatMap((slot) =>
      state.gear[slot].functionMods.map((hash) => (hash ? modByHash.get(String(hash)) : null)).filter(Boolean)
    );
  }

  function communityEffects() {
    const fontCounts = {};
    const surgeCounts = {};
    for (const mod of allFunctionMods()) {
      const font = fontStatFromMod(mod);
      if (font) fontCounts[font] = (fontCounts[font] || 0) + 1;
      const surge = surgeName(mod);
      if (surge) surgeCounts[surge] = (surgeCounts[surge] || 0) + 1;
    }

    const statBonus = emptyStats();
    const fontRows = Object.entries(fontCounts).map(([stat, count]) => {
      const value = data.communityData.fontStatBonus[Math.min(count, 3)] || 0;
      statBonus[stat] += value;
      return { stat, count, value };
    });
    const surgeRows = Object.entries(surgeCounts).map(([name, count]) => ({
      name,
      count,
      value: data.communityData.weaponSurgeDamage[Math.min(count, 3)] || 0,
    }));
    return { statBonus, fontRows, surgeRows };
  }

  function calculateTotals() {
    const total = emptyStats();
    for (const slot of SLOT_ORDER) addStats(total, calculatePiece(slot));
    if (state.community) addStats(total, communityEffects().statBonus);
    return total;
  }

  function selectedSetCounts() {
    const counts = new Map();
    for (const slot of SLOT_ORDER) {
      const cfg = state.gear[slot];
      if (!cfg.setHash || cfg.exoticHash) continue;
      counts.set(String(cfg.setHash), (counts.get(String(cfg.setHash)) || 0) + 1);
    }
    return counts;
  }

  function selectedExotics() {
    return SLOT_ORDER.map((slot) => (state.gear[slot].exoticHash ? exoticByHash.get(String(state.gear[slot].exoticHash)) : null)).filter(Boolean);
  }

  function energyForSlot(slot) {
    const cfg = state.gear[slot];
    const attr = cfg.attrModHash ? modByHash.get(String(cfg.attrModHash)) : null;
    const functions = cfg.functionMods.map((hash) => (hash ? modByHash.get(String(hash)) : null)).filter(Boolean);
    return (attr ? modCost(attr) : 0) + functions.reduce((sum, mod) => sum + modCost(mod), 0);
  }

  function gearIcon(slot) {
    const exotic = state.gear[slot].exoticHash ? exoticByHash.get(String(state.gear[slot].exoticHash)) : null;
    if (exotic?.icon) return exotic.icon;
    const set = setByHash.get(String(state.gear[slot].setHash));
    return set?.perks?.[0]?.icon || "";
  }

  function gearName(slot) {
    const exotic = state.gear[slot].exoticHash ? exoticByHash.get(String(state.gear[slot].exoticHash)) : null;
    if (exotic) return text(exotic.name);
    const set = setByHash.get(String(state.gear[slot].setHash));
    return set ? text(set.name) : "非套装";
  }

  function option(value, label, selected) {
    return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function iconMarkup(src, className = "icon") {
    return src ? `<img class="${className}" src="${escapeHtml(src)}" alt="" />` : `<span class="${className} placeholder-icon"></span>`;
  }

  function renderMetrics() {
    $("#metricSets").textContent = String(data.sets.length);
    $("#metricMods").textContent = `${data.armorMods.filter((mod) => !isHiddenMod(mod)).length} / ${data.rawArmorModCount}`;
    $("#metricExotics").textContent = String(data.exoticArmor.length);
    $("#metricManifest").textContent = data.meta.manifestVersion;
  }

  function renderControls() {
    $("#classSelect").innerHTML = ["hunter", "titan", "warlock"].map((klass) => option(klass, classLabel(klass), state.klass)).join("");
    const categories = ["all", ...Array.from(new Set(data.sets.map((set) => set.category))).sort()];
    $("#builderSetCategory").innerHTML = categories.map((cat) => option(cat, cat === "all" ? "全部来源" : cat, state.setCategory)).join("");
    $("#builderExoticSlot").innerHTML = [["all", "全部部位"], ...SLOT_ORDER.map((slot) => [slot, slotLabel(slot)])]
      .map(([value, label]) => option(value, label, state.exoticSlot))
      .join("");
    $("#modSlotFilter").innerHTML = [["all", "全部部位"], ...SLOT_ORDER.map((slot) => [slot, slotLabel(slot)])]
      .map(([value, label]) => option(value, label, state.modSlot))
      .join("");
    $("#modTypeFilter").innerHTML = [
      ["all", "全部模组"],
      ["attr", "属性模组"],
      ["function", "功能模组"],
      ["font", "Font"],
      ["surge", "Surge"],
    ].map(([value, label]) => option(value, label, state.modType)).join("");
    $("#communityToggle").checked = state.community;
  }

  function renderGearSlots() {
    const setOptions = (selected) =>
      [option("", "非套装", selected), ...data.sets.map((set) => option(set.hash, `${text(set.name)} / ${english(set.name)}`, selected))].join("");

    $("#gearSlots").innerHTML = SLOT_ORDER.map((slot) => {
      normalizeGear(slot);
      const cfg = state.gear[slot];
      const arch = archByHash.get(String(cfg.archetypeHash)) || getDefaultArchetype();
      const tertiaryOptions = STAT_ORDER.filter((id) => id !== arch.primary && id !== arch.secondary);
      const exotics = data.exoticArmor
        .filter((item) => item.class === state.klass && item.slot === slot)
        .sort((a, b) => english(a.name).localeCompare(english(b.name)));
      const attrMod = cfg.attrModHash ? modByHash.get(String(cfg.attrModHash)) : null;
      const functionCount = cfg.functionMods.filter(Boolean).length;
      const tuningLabel = tuningOptionsFor(slot).find(([value]) => value === cfg.tuningMode)?.[1] || "不使用";
      const exotic = cfg.exoticHash ? exoticByHash.get(String(cfg.exoticHash)) : null;
      return `
        <article class="gear-card ${exotic ? "has-exotic" : ""}" data-gear-card="${slot}">
          <div class="gear-title">
            ${iconMarkup(gearIcon(slot), "gear-icon")}
            <div>
              <div class="slot-name"><span class="slot-dot">${SLOT_MARK[slot]}</span>${slotLabel(slot)}</div>
              <strong>${escapeHtml(gearName(slot))}</strong>
            </div>
            <span class="energy-readout">${energyForSlot(slot)}/10</span>
          </div>
          <div class="gear-controls">
            <label><span>套装</span><select data-gear="${slot}" data-field="setHash">${setOptions(cfg.setHash)}</select></label>
            <label><span>异域</span><select data-gear="${slot}" data-field="exoticHash">
              ${option("", "无异域", cfg.exoticHash)}
              ${exotics.map((item) => option(item.hash, `${text(item.name)} / ${english(item.name)}`, cfg.exoticHash)).join("")}
            </select></label>
            <label><span>框架</span><select data-gear="${slot}" data-field="archetypeHash">
              ${data.archetypes.map((item) => option(item.hash, `${text(item.name)} · ${statName(item.primary)} / ${statName(item.secondary)}`, cfg.archetypeHash)).join("")}
            </select></label>
            <label><span>Tier</span><select data-gear="${slot}" data-field="tier">
              ${Object.entries(TIER_PRESETS).map(([tier, preset]) => option(tier, `${preset.label} · ${preset.primary + preset.secondary + preset.tertiary}`, cfg.tier)).join("")}
            </select></label>
            <label><span>大师</span><select data-gear="${slot}" data-field="masterwork">
              ${[0, 1, 2, 3, 4, 5].map((value) => option(value, `+${value}`, cfg.masterwork)).join("")}
            </select></label>
            <label><span>第三属性</span><select data-gear="${slot}" data-field="tertiary">
              ${tertiaryOptions.map((id) => option(id, statName(id), cfg.tertiary)).join("")}
            </select></label>
            <label><span>Tuned</span><select data-gear="${slot}" data-field="tuned" ${Number(cfg.tier) < 5 ? "disabled" : ""}>
              ${STAT_ORDER.map((id) => option(id, statName(id), cfg.tuned)).join("")}
            </select></label>
          </div>
          <div class="gear-mod-summary">
            <span>${attrMod ? `${text(attrMod.name)} · ${statModEffect(attrMod)?.value || 0}` : "无属性模组"}</span>
            <span>${tuningLabel}</span>
            <span>${functionCount}/3 功能槽</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderStatsInto(selector) {
    const total = calculateTotals();
    $(selector).innerHTML = STAT_ORDER.map((id) => {
      const value = total[id];
      const width = Math.min(100, (Math.min(value, 200) / 200) * 100);
      return `
        <div class="stat-row">
          <div class="stat-name"><span>${STAT_MARK[id]}</span><strong>${statName(id)}</strong></div>
          <div class="stat-track"><div class="stat-fill ${value > 200 ? "over" : ""}" style="--w:${width}%"></div></div>
          <div class="stat-value">${value}</div>
        </div>
      `;
    }).join("");
  }

  function renderActiveEffects() {
    const rows = Array.from(selectedSetCounts().entries())
      .map(([hash, count]) => ({ set: setByHash.get(hash), count }))
      .filter((row) => row.set)
      .sort((a, b) => b.count - a.count || english(a.set.name).localeCompare(english(b.set.name)));

    $("#activeSetBonuses").innerHTML = rows.length ? rows.map(({ set, count }) => `
      <article class="effect-card">
        <div class="effect-head">
          ${iconMarkup(set.perks?.[0]?.icon, "tiny-icon")}
          <div><strong>${escapeHtml(text(set.name))}</strong><span>${escapeHtml(set.source || set.category)} · ${count}/5</span></div>
        </div>
        <div class="perk-list">
          ${set.perks.map((perk) => `
            <div class="perk-line ${count >= perk.required ? "is-active" : ""}">
              ${iconMarkup(perk.icon, "tiny-icon")}
              <div><b>${perk.required} 件 · ${escapeHtml(text(perk.name))}</b><p>${escapeHtml(text(perk.description))}</p></div>
            </div>
          `).join("")}
        </div>
      </article>
    `).join("") : `<div class="empty-state">未激活套装效果</div>`;

    const exotic = selectedExotics()[0];
    $("#activeExotic").innerHTML = exotic ? `
      <article class="effect-card exotic-effect">
        <div class="effect-head">
          ${iconMarkup(exotic.icon, "tiny-icon")}
          <div><strong>${escapeHtml(text(exotic.name))}</strong><span>${escapeHtml(exotic.classLabel)} · ${escapeHtml(exotic.slotLabel)}</span></div>
        </div>
        <div class="perk-list">
          ${(exotic.intrinsic || []).map((perk) => `
            <div class="perk-line is-active">
              ${iconMarkup(perk.icon, "tiny-icon")}
              <div><b>${escapeHtml(text(perk.name))}</b><p>${escapeHtml(text(perk.description))}</p></div>
            </div>
          `).join("")}
        </div>
      </article>
    ` : `<div class="empty-state">未装备异域护甲</div>`;
  }

  function setMatches(set) {
    const query = state.setSearch.trim().toLowerCase();
    if (state.setCategory !== "all" && set.category !== state.setCategory) return false;
    if (!query) return true;
    return [text(set.name), english(set.name), set.source, set.activity, set.category, ...set.perks.flatMap((perk) => [text(perk.name), english(perk.name), text(perk.description), english(perk.description)])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderBuilderSets() {
    const sets = data.sets.filter(setMatches);
    $("#builderSetAtlas").innerHTML = sets.map((set) => `
      <article class="atlas-card set-card">
        <div class="atlas-head">
          ${iconMarkup(set.perks?.[0]?.icon, "atlas-icon")}
          <div><strong>${escapeHtml(text(set.name))}</strong><span>${escapeHtml(english(set.name))} · ${escapeHtml(set.category)}</span></div>
          <button class="soft-button" type="button" data-equip-set="${set.hash}">装备 5 件</button>
        </div>
        <div class="perk-list compact">
          ${set.perks.map((perk) => `
            <div class="perk-line">
              ${iconMarkup(perk.icon, "tiny-icon")}
              <div><b>${perk.required} 件 · ${escapeHtml(text(perk.name))}</b><p>${escapeHtml(text(perk.description))}</p></div>
            </div>
          `).join("")}
        </div>
      </article>
    `).join("") || `<div class="empty-state">没有匹配的套装</div>`;
  }

  function exoticMatches(item) {
    const query = state.exoticSearch.trim().toLowerCase();
    if (item.class !== state.klass) return false;
    if (state.exoticSlot !== "all" && item.slot !== state.exoticSlot) return false;
    if (!query) return true;
    return [text(item.name), english(item.name), item.slotLabel, ...item.intrinsic.flatMap((perk) => [text(perk.name), english(perk.name), text(perk.description), english(perk.description)])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderBuilderExotics() {
    const exotics = data.exoticArmor.filter(exoticMatches).sort((a, b) => a.slot.localeCompare(b.slot) || english(a.name).localeCompare(english(b.name)));
    $("#builderExoticAtlas").innerHTML = exotics.map((item) => `
      <article class="atlas-card exotic-card">
        <div class="atlas-head">
          ${iconMarkup(item.icon, "atlas-icon")}
          <div><strong>${escapeHtml(text(item.name))}</strong><span>${escapeHtml(english(item.name))} · ${escapeHtml(item.slotLabel)}</span></div>
          <button class="soft-button" type="button" data-equip-exotic="${item.hash}">装备</button>
        </div>
        ${(item.intrinsic || []).slice(0, 2).map((perk) => `
          <div class="perk-line">
            ${iconMarkup(perk.icon, "tiny-icon")}
            <div><b>${escapeHtml(text(perk.name))}</b><p>${escapeHtml(text(perk.description))}</p></div>
          </div>
        `).join("")}
      </article>
    `).join("") || `<div class="empty-state">没有匹配的异域</div>`;
  }

  function modMatches(mod) {
    if (isHiddenMod(mod)) return false;
    const isAttr = isStatMod(mod);
    const font = fontStatFromMod(mod);
    const surge = surgeName(mod);
    if (state.modType === "attr" && !isAttr) return false;
    if (state.modType === "function" && isAttr) return false;
    if (state.modType === "font" && !font) return false;
    if (state.modType === "surge" && !surge) return false;
    if (state.modSlot !== "all" && !isAttr && mod.slot !== state.modSlot) return false;
    const query = state.modSearch.trim().toLowerCase();
    if (!query) return true;
    return [text(mod.name), english(mod.name), text(mod.description), english(mod.description), mod.slotLabel]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function renderModLibrary() {
    const mods = data.armorMods.filter(modMatches).sort((a, b) => {
      const typeA = isStatMod(a) ? 0 : 1;
      const typeB = isStatMod(b) ? 0 : 1;
      return typeA - typeB || String(a.slot).localeCompare(String(b.slot)) || english(a.name).localeCompare(english(b.name));
    });
    $("#modResultCount").textContent = `${mods.length}/${data.armorMods.filter((mod) => !isHiddenMod(mod)).length}`;
    $("#modLibrary").innerHTML = mods.map((mod) => {
      const effect = statModEffect(mod);
      const tags = [
        effect ? `+${effect.value} ${statName(effect.stat)}` : mod.slotLabel,
        modEnergyLabel(mod) ? `${modEnergyLabel(mod)} 能量` : "",
        mod.duplicateCount > 1 ? `合并 ${mod.duplicateCount}` : "",
        fontStatFromMod(mod) || surgeName(mod) ? "社区值" : "",
      ].filter(Boolean);
      return `
        <article class="mod-card" data-mod-card="${mod.hash}" tabindex="0">
          ${iconMarkup(mod.icon, "mod-icon")}
          <div>
            <div class="mod-title"><strong>${escapeHtml(text(mod.name))}</strong><span>${escapeHtml(english(mod.name))}</span></div>
            <div class="tag-row">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>
            <p>${escapeHtml(text(mod.description) || english(mod.description))}</p>
          </div>
        </article>
      `;
    }).join("") || `<div class="empty-state">没有匹配的模组</div>`;
  }

  function socketMarkup(slot, type, index, mod) {
    const attrs = `data-socket-slot="${slot}" data-socket-type="${type}" ${type === "function" ? `data-socket-index="${index}"` : ""}`;
    if (!mod) {
      return `<div class="socket empty" ${attrs}><span>${type === "attr" ? "属性槽" : "功能槽"}</span></div>`;
    }
    const effect = statModEffect(mod);
    return `
      <div class="socket filled" ${attrs}>
        ${iconMarkup(mod.icon, "socket-icon")}
        <div><strong>${escapeHtml(text(mod.name))}</strong><span>${effect ? `+${effect.value} ${statName(effect.stat)}` : `${modEnergyLabel(mod)} 能量`}</span></div>
        <button class="icon-button" type="button" data-remove-mod data-remove-slot="${slot}" data-remove-type="${type}" ${type === "function" ? `data-remove-index="${index}"` : ""}>×</button>
      </div>
    `;
  }

  function renderModSlots() {
    $("#modSlots").innerHTML = SLOT_ORDER.map((slot) => {
      normalizeGear(slot);
      const cfg = state.gear[slot];
      const attrMod = cfg.attrModHash ? modByHash.get(String(cfg.attrModHash)) : null;
      const functions = cfg.functionMods.map((hash) => (hash ? modByHash.get(String(hash)) : null));
      return `
        <article class="mod-piece">
          <div class="mod-piece-head">
            ${iconMarkup(gearIcon(slot), "gear-icon")}
            <div><strong>${slotLabel(slot)}</strong><span>${escapeHtml(gearName(slot))}</span></div>
            <span class="energy-readout">${energyForSlot(slot)}/10</span>
          </div>
          <div class="socket-layout">
            <div class="socket-block">
              <span class="socket-label">属性 mod</span>
              ${socketMarkup(slot, "attr", 0, attrMod)}
            </div>
            <label class="socket-block tuning-block">
              <span class="socket-label">Tuning</span>
              <select data-tuning-slot="${slot}" ${Number(cfg.tier) < 5 ? "disabled" : ""}>
                ${tuningOptionsFor(slot).map(([value, label]) => option(value, label, cfg.tuningMode)).join("")}
              </select>
            </label>
            <div class="socket-block function-block">
              <span class="socket-label">功能 mod</span>
              <div class="function-sockets">
                ${functions.map((mod, index) => socketMarkup(slot, "function", index, mod)).join("")}
              </div>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderCommunitySummary() {
    const effects = communityEffects();
    const rows = [];
    for (const item of effects.fontRows) {
      rows.push(`<article class="effect-card"><strong>${statName(item.stat)} Font ×${item.count}</strong><p>社区估测：+${item.value} ${statName(item.stat)}，${state.community ? "已计入" : "未计入"}总属性。</p></article>`);
    }
    for (const item of effects.surgeRows) {
      rows.push(`<article class="effect-card"><strong>${escapeHtml(item.name)} ×${item.count}</strong><p>社区估测：武器伤害约 +${item.value}%。</p></article>`);
    }
    $("#communitySummary").innerHTML = rows.join("") || `<div class="empty-state">暂无社区估测条目</div>`;
  }

  function renderReference() {
    $("#archetypeList").innerHTML = data.archetypes.map((arch) => `
      <article class="reference-card">
        <strong>${escapeHtml(text(arch.name))}</strong>
        <span>${statName(arch.primary)} / ${statName(arch.secondary)}</span>
        <p>${escapeHtml(text(arch.description))}</p>
      </article>
    `).join("");

    $("#tuningList").innerHTML = [
      {
        name: "Balanced",
        description: "最低三项属性各 +1。",
        deltas: Object.fromEntries(STAT_ORDER.map((id) => [id, 1])),
      },
      ...data.tuningMods,
    ].map((item) => `
      <article class="reference-card">
        <strong>${escapeHtml(text(item.name) || item.name)}</strong>
        <span>${Object.entries(item.deltas || {}).map(([id, value]) => `${value > 0 ? "+" : ""}${value} ${statName(id)}`).join(" / ")}</span>
        <p>${escapeHtml(text(item.description) || item.description)}</p>
      </article>
    `).join("");

    $("#sourceNotes").innerHTML = [
      ...data.meta.notes.map((note) => `<article class="reference-card"><p>${escapeHtml(note)}</p></article>`),
      ...data.communityData.notes.map((note) => `<article class="reference-card"><p>${escapeHtml(note)}</p></article>`),
      ...data.meta.sourceUrls.map((url) => `<article class="reference-card"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></article>`),
    ].join("");
  }

  function renderAll() {
    for (const slot of SLOT_ORDER) normalizeGear(slot);
    renderMetrics();
    renderControls();
    renderGearSlots();
    renderStatsInto("#statBars");
    renderStatsInto("#modStatPreview");
    renderActiveEffects();
    renderBuilderSets();
    renderBuilderExotics();
    renderModLibrary();
    renderModSlots();
    renderCommunitySummary();
    renderReference();
  }

  function placeMod(hash, slot, type, index = 0) {
    const mod = modByHash.get(String(hash));
    if (!modFitsSocket(mod, type, slot)) return false;
    if (type === "attr") state.gear[slot].attrModHash = String(hash);
    if (type === "function") state.gear[slot].functionMods[Number(index)] = String(hash);
    renderAll();
    return true;
  }

  function addModToFirstSocket(hash) {
    const mod = modByHash.get(String(hash));
    if (!mod || isHiddenMod(mod)) return false;
    if (isStatMod(mod)) {
      for (const slot of SLOT_ORDER) {
        if (!state.gear[slot].attrModHash) return placeMod(hash, slot, "attr", 0);
      }
      return placeMod(hash, SLOT_ORDER[0], "attr", 0);
    }
    for (const slot of SLOT_ORDER) {
      if (!compatibleFunctionMod(mod, slot)) continue;
      const index = state.gear[slot].functionMods.findIndex((value) => !value);
      if (index !== -1) return placeMod(hash, slot, "function", index);
    }
    const slot = SLOT_ORDER.find((item) => compatibleFunctionMod(mod, item));
    return slot ? placeMod(hash, slot, "function", 0) : false;
  }

  function clearDrag() {
    $$(".mod-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
    $$(".socket.is-target").forEach((socket) => socket.classList.remove("is-target"));
    state.drag = null;
  }

  function nearestSocket(x, y, hash) {
    const direct = document.elementFromPoint(x, y)?.closest?.("[data-socket-slot]");
    if (direct) return direct;
    const mod = modByHash.get(String(hash));
    if (!mod) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const socket of $$("[data-socket-slot]")) {
      const slot = socket.dataset.socketSlot;
      const type = socket.dataset.socketType;
      if (!modFitsSocket(mod, type, slot)) continue;
      const rect = socket.getBoundingClientRect();
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        best = socket;
        bestDistance = distance;
      }
    }
    return bestDistance <= 72 ? best : null;
  }

  function updateDragTarget(x, y, hash) {
    $$(".socket.is-target").forEach((socket) => socket.classList.remove("is-target"));
    const socket = nearestSocket(x, y, hash);
    if (!socket) return null;
    const mod = modByHash.get(String(hash));
    if (modFitsSocket(mod, socket.dataset.socketType, socket.dataset.socketSlot)) {
      socket.classList.add("is-target");
      return socket;
    }
    return null;
  }

  function activateTab(id) {
    state.activeTab = id;
    $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === id));
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === id));
  }

  function bindEvents() {
    $(".top-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (button) activateTab(button.dataset.tab);
    });

    $("#classSelect").addEventListener("change", (event) => {
      state.klass = event.target.value;
      for (const slot of SLOT_ORDER) normalizeGear(slot);
      renderAll();
    });

    $("#communityToggle").addEventListener("change", (event) => {
      state.community = event.target.checked;
      renderAll();
    });

    $("#gearSlots").addEventListener("change", (event) => {
      const select = event.target.closest("[data-gear][data-field]");
      if (!select) return;
      const slot = select.dataset.gear;
      const field = select.dataset.field;
      state.gear[slot][field] = ["tier", "masterwork"].includes(field) ? Number(select.value) : select.value;
      if (field === "exoticHash" && select.value) {
        for (const other of SLOT_ORDER) if (other !== slot) state.gear[other].exoticHash = "";
      }
      normalizeGear(slot);
      renderAll();
    });

    $("#builderSetSearch").addEventListener("input", (event) => {
      state.setSearch = event.target.value;
      renderBuilderSets();
    });
    $("#builderSetCategory").addEventListener("change", (event) => {
      state.setCategory = event.target.value;
      renderBuilderSets();
    });
    $("#builderExoticSearch").addEventListener("input", (event) => {
      state.exoticSearch = event.target.value;
      renderBuilderExotics();
    });
    $("#builderExoticSlot").addEventListener("change", (event) => {
      state.exoticSlot = event.target.value;
      renderBuilderExotics();
    });
    $("#builder").addEventListener("click", (event) => {
      const setButton = event.target.closest("[data-equip-set]");
      if (setButton) {
        for (const slot of SLOT_ORDER) {
          state.gear[slot].setHash = String(setButton.dataset.equipSet);
          state.gear[slot].exoticHash = "";
        }
        renderAll();
        return;
      }
      const exoticButton = event.target.closest("[data-equip-exotic]");
      if (exoticButton) {
        const exotic = exoticByHash.get(String(exoticButton.dataset.equipExotic));
        if (!exotic) return;
        for (const slot of SLOT_ORDER) state.gear[slot].exoticHash = "";
        state.gear[exotic.slot].exoticHash = String(exotic.hash);
        renderAll();
      }
    });

    $("#modSearch").addEventListener("input", (event) => {
      state.modSearch = event.target.value;
      renderModLibrary();
    });
    $("#modTypeFilter").addEventListener("change", (event) => {
      state.modType = event.target.value;
      renderModLibrary();
    });
    $("#modSlotFilter").addEventListener("change", (event) => {
      state.modSlot = event.target.value;
      renderModLibrary();
    });
    $("#clearModsBtn").addEventListener("click", () => {
      for (const slot of SLOT_ORDER) {
        state.gear[slot].attrModHash = "";
        state.gear[slot].functionMods = ["", "", ""];
        state.gear[slot].tuningMode = "";
      }
      renderAll();
    });

    $("#modSlots").addEventListener("change", (event) => {
      const select = event.target.closest("[data-tuning-slot]");
      if (!select) return;
      state.gear[select.dataset.tuningSlot].tuningMode = select.value;
      renderAll();
    });
    $("#modSlots").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-mod]");
      if (!button) return;
      const slot = button.dataset.removeSlot;
      if (button.dataset.removeType === "attr") state.gear[slot].attrModHash = "";
      if (button.dataset.removeType === "function") state.gear[slot].functionMods[Number(button.dataset.removeIndex)] = "";
      renderAll();
    });

    $("#modLibrary").addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const card = event.target.closest("[data-mod-card]");
      if (!card) return;
      state.drag = {
        hash: card.dataset.modCard,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      card.classList.add("is-dragging");
      card.setPointerCapture?.(event.pointerId);
    });

    document.addEventListener("pointermove", (event) => {
      if (!state.drag) return;
      const distance = Math.hypot(event.clientX - state.drag.startX, event.clientY - state.drag.startY);
      if (distance < 7) return;
      state.drag.active = true;
      updateDragTarget(event.clientX, event.clientY, state.drag.hash);
    });

    document.addEventListener("pointerup", (event) => {
      const drag = state.drag;
      if (!drag) return;
      let placed = false;
      if (drag.active) {
        const socket = updateDragTarget(event.clientX, event.clientY, drag.hash);
        if (socket) placed = placeMod(drag.hash, socket.dataset.socketSlot, socket.dataset.socketType, socket.dataset.socketIndex || 0);
      }
      state.suppressClick = drag.active;
      clearDrag();
      if (placed) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    $("#modLibrary").addEventListener("click", (event) => {
      if (state.suppressClick) {
        state.suppressClick = false;
        return;
      }
      const card = event.target.closest("[data-mod-card]");
      if (card) addModToFirstSocket(card.dataset.modCard);
    });

    $("#modLibrary").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-mod-card]");
      if (!card) return;
      event.preventDefault();
      addModToFirstSocket(card.dataset.modCard);
    });
  }

  initGear();
  bindEvents();
  renderAll();
})();
