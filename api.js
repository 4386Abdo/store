/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CONFIG, SEED_DATA } from './config.js';

const VALID_CONDITIONS = Object.keys(CONFIG.CONDITIONS);

function computeStatus(item) {
  const qty = Number(item.quantity);
  return qty <= 0 ? 'out_of_stock' : qty <= Number(item.min_limit) ? 'low' : 'available';
}

function withDefaults(item) {
  return {
    ...item,
    condition: VALID_CONDITIONS.includes(item.condition) ? item.condition : CONFIG.DEFAULT_CONDITION,
    condition_note: item.condition_note || '',
    status: computeStatus(item),
  };
}


// متغيرات حالة العميل
let supabaseClient = null;
let realtimeListeners = [];

// فحص وجود عميل Supabase من مكتبة CDN
function initSupabase() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase) {
    try {
      supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      return true;
    } catch (e) {
      console.warn('Supabase init fallback to local:', e);
    }
  }
  return false;
}

// تهيئة التخزين المحلي بالبيانات الأولية عند أول تشغيل
function initLocalStorage() {
  const S = CONFIG.STORAGE_KEYS;
  if (!localStorage.getItem(S.LOCAL_ITEMS)) {
    localStorage.setItem(S.LOCAL_ITEMS, JSON.stringify(SEED_DATA.items));
  }
  if (!localStorage.getItem(S.LOCAL_CATEGORIES)) {
    localStorage.setItem(S.LOCAL_CATEGORIES, JSON.stringify(SEED_DATA.categories));
  }
  if (!localStorage.getItem(S.LOCAL_SUPPLIERS)) {
    localStorage.setItem(S.LOCAL_SUPPLIERS, JSON.stringify(SEED_DATA.suppliers));
  }
  if (!localStorage.getItem(S.LOCAL_MOVEMENTS)) {
    localStorage.setItem(S.LOCAL_MOVEMENTS, JSON.stringify(SEED_DATA.movements));
  }
  if (!localStorage.getItem(S.LOCAL_TEMPLATES)) {
    localStorage.setItem(S.LOCAL_TEMPLATES, JSON.stringify(SEED_DATA.job_templates));
  }
  if (!localStorage.getItem(S.LOCAL_SETTINGS)) {
    localStorage.setItem(S.LOCAL_SETTINGS, JSON.stringify(SEED_DATA.settings));
  }
}

initSupabase();
initLocalStorage();

// بث الأحداث اللحظية محلياً وفي النوافذ الأخرى
function triggerRealtime(table, payload) {
  realtimeListeners.forEach(fn => {
    try { fn(table, payload); } catch(err) { console.error(err); }
  });
  // بث عبر التخزين المحلي للمتصفح لمزامنة النوافذ الأخرى
  try {
    localStorage.setItem('studio_realtime_event', JSON.stringify({
      table,
      payload,
      timestamp: Date.now()
    }));
  } catch (e) {}
}

window.addEventListener('storage', (e) => {
  if (e.key === 'studio_realtime_event' && e.newValue) {
    try {
      const data = JSON.parse(e.newValue);
      realtimeListeners.forEach(fn => fn(data.table, data.payload));
    } catch(err) {}
  }
});

// ============================================================================
// 1. نظام المصادقة والحماية الآمن (Authentication & Security)
// ============================================================================

export const AuthAPI = {
  // فحص حالة القفل المؤقت بسبب المحاولات الخاطئة
  getLockoutStatus() {
    const lockoutStr = localStorage.getItem(CONFIG.STORAGE_KEYS.LOCKOUT_STATE);
    if (!lockoutStr) return { isLocked: false, remainingSeconds: 0 };

    const lockoutUntil = parseInt(lockoutStr, 10);
    const now = Date.now();
    if (now < lockoutUntil) {
      const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
      return { isLocked: true, remainingSeconds };
    }

    // انتهى وقت القفل، مسح الحالة
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LOCKOUT_STATE);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.FAILED_ATTEMPTS);
    return { isLocked: false, remainingSeconds: 0 };
  },

  // تسجيل محاولة فاشلة
  recordFailedAttempt() {
    let attempts = parseInt(localStorage.getItem(CONFIG.STORAGE_KEYS.FAILED_ATTEMPTS) || '0', 10) + 1;
    localStorage.setItem(CONFIG.STORAGE_KEYS.FAILED_ATTEMPTS, attempts.toString());

    if (attempts >= CONFIG.SECURITY.MAX_FAILED_ATTEMPTS) {
      const lockUntil = Date.now() + CONFIG.SECURITY.LOCKOUT_DURATION_MS;
      localStorage.setItem(CONFIG.STORAGE_KEYS.LOCKOUT_STATE, lockUntil.toString());
      return { isLocked: true, attempts, remainingSeconds: CONFIG.SECURITY.LOCKOUT_DURATION_MS / 1000 };
    }

    return { isLocked: false, attempts, remainingAttempts: CONFIG.SECURITY.MAX_FAILED_ATTEMPTS - attempts };
  },

  // مسح المحاولات الفاشلة عند الدخول الصحيح
  resetFailedAttempts() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.FAILED_ATTEMPTS);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LOCKOUT_STATE);
  },

  // الدخول الآمن برمز PIN (يُستخدم كباسورد لحساب Supabase Auth)
  async signInWithPin(pin, role = 'editor') {
    // التحقق من القفل أولاً
    const lockout = this.getLockoutStatus();
    if (lockout.isLocked) {
      throw new Error(`النظام مقفل مؤقتاً لكثرة المحاولات الخاطئة. انتظر ${lockout.remainingSeconds} ثانية.`);
    }

    if (!pin || pin.length < 6) {
      throw new Error('الرمز يجب أن يتكون من 6 أرقام على الأقل');
    }

    const email = role === 'editor' ? CONFIG.EDITOR_AUTH_EMAIL : CONFIG.VIEWER_AUTH_EMAIL;

    // 1) في حالة وجود ربط حقيقي مع Supabase
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email,
          password: pin,
        });

        if (error) {
          const res = this.recordFailedAttempt();
          if (res.isLocked) {
            throw new Error(`رمز خاطئ! تم قفل النظام لمدة 5 دقائق بعد ${res.attempts} محاولات`);
          }
          throw new Error(`الرمز غير صحيح. المحاولات المتبقية: ${res.remainingAttempts}`);
        }

        this.resetFailedAttempts();
        const session = {
          role,
          email,
          user_id: data.user.id,
          token: data.session.access_token,
          expires_at: Date.now() + CONFIG.SECURITY.INACTIVITY_TIMEOUT_MS,
          last_activity: Date.now()
        };
        sessionStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(session));
        return { success: true, role, user: data.user };
      } catch (err) {
        throw err;
      }
    }

    // 2) في حالة الوضع المحلي / Offline
    // استخدام الرمز المخزن محلياً أو الرمز الافتراضي
    const storedPin = localStorage.getItem(`studio_${role}_pin`) ||
      (role === 'editor' ? CONFIG.DEFAULT_EDITOR_PIN : CONFIG.DEFAULT_VIEWER_PIN);

    if (pin === storedPin) {
      this.resetFailedAttempts();
      const session = {
        role,
        email,
        user_id: `local-${role}-id`,
        expires_at: Date.now() + CONFIG.SECURITY.INACTIVITY_TIMEOUT_MS,
        last_activity: Date.now()
      };
      sessionStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(session));
      return { success: true, role };
    } else {
      const res = this.recordFailedAttempt();
      if (res.isLocked) {
        throw new Error(`رمز خاطئ! تم قفل النظام لمدة 5 دقائق بعد ${res.attempts} محاولات`);
      }
      throw new Error(`الرمز غير صحيح. المحاولات المتبقية: ${res.remainingAttempts}`);
    }
  },

  // تغيير الرمز
  async changePin(currentPin, newPin, role = 'editor') {
    if (!newPin || newPin.length < 6) {
      throw new Error('الرمز الجديد يجب ألا يقل عن 6 أرقام');
    }

    if (supabaseClient) {
      // التحقق وتحديث كلمة المرور في Supabase Auth
      const { error } = await supabaseClient.auth.updateUser({
        password: newPin,
      });
      if (error) throw new Error('فشل تحديث الرمز في Supabase: ' + error.message);
      return { success: true };
    }

    // في الوضع المحلي
    const storedPin = localStorage.getItem(`studio_${role}_pin`) ||
      (role === 'editor' ? CONFIG.DEFAULT_EDITOR_PIN : CONFIG.DEFAULT_VIEWER_PIN);

    if (currentPin !== storedPin) {
      throw new Error('الرمز الحالي غير صحيح');
    }

    localStorage.setItem(`studio_${role}_pin`, newPin);
    return { success: true };
  },

  // فحص الجلسة الحالية وتحديث توقيت آخر نشاط
  checkSession(requiredRole = null) {
    const sessionStr = sessionStorage.getItem(CONFIG.STORAGE_KEYS.CURRENT_SESSION);
    if (!sessionStr) return null;

    try {
      const session = JSON.parse(sessionStr);
      const now = Date.now();

      // التحقق من مهلة الخمول
      if (now - session.last_activity > CONFIG.SECURITY.INACTIVITY_TIMEOUT_MS) {
        this.signOut();
        return null;
      }

      // تحديث آخر نشاط
      session.last_activity = now;
      sessionStorage.setItem(CONFIG.STORAGE_KEYS.CURRENT_SESSION, JSON.stringify(session));

      if (requiredRole && session.role !== requiredRole && session.role !== 'editor') {
        return null;
      }

      return session;
    } catch (e) {
      return null;
    }
  },

  // تسجيل الخروج
  async signOut() {
    if (supabaseClient) {
      try { await supabaseClient.auth.signOut(); } catch(e) {}
    }
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.CURRENT_SESSION);
  }
};

// ============================================================================
// 2. عمليات البيانات والمخزون والحركات (Data & RPC Layer)
// ============================================================================

export const InventoryAPI = {
  // هل النظام متصل بـ Supabase حقيقي؟
  isLiveSupabase() {
    return !!supabaseClient;
  },

  // الاشتراك في التحديثات اللحظية (Realtime)
  subscribeRealtime(callback) {
    realtimeListeners.push(callback);

    if (supabaseClient) {
      const channel = supabaseClient
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public' },
          (payload) => {
            callback(payload.table, payload);
          }
        )
        .subscribe();

      return () => {
        supabaseClient.removeChannel(channel);
        realtimeListeners = realtimeListeners.filter(cb => cb !== callback);
      };
    }

    return () => {
      realtimeListeners = realtimeListeners.filter(cb => cb !== callback);
    };
  },

  // --------------------------------------------------------------------------
  // الأصناف (Items)
  // --------------------------------------------------------------------------
  async getItems(includeArchived = false) {
    if (supabaseClient) {
      let query = supabaseClient.from('items').select('*, categories(name), suppliers(name)');
      if (!includeArchived) query = query.eq('is_archived', false);
      const { data, error } = await query.order('name');
      if (error) throw error;
      return data.map(withDefaults);
    }

    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const categories = await this.getCategories();
    const suppliers = await this.getSuppliers();

    const catMap = new Map(categories.map(c => [c.id, c.name]));
    const supMap = new Map(suppliers.map(s => [s.id, s.name]));

    const enriched = items.map(item => ({
      ...item,
      categories: { name: catMap.get(item.category_id) || '' },
      suppliers: { name: supMap.get(item.supplier_id) || '' },
    })).map(withDefaults);

    return includeArchived ? enriched : enriched.filter(i => !i.is_archived);
  },

  async getItemById(id) {
    const items = await this.getItems(true);
    return items.find(i => i.id === id) || null;
  },

  async getItemBySku(sku) {
    const items = await this.getItems(true);
    return items.find(i => i.sku?.trim().toUpperCase() === sku.trim().toUpperCase()) || null;
  },

  async saveItem(itemData) {
    if (!itemData.name?.trim()) throw new Error('اسم الصنف مطلوب');
    if (!itemData.sku?.trim()) {
      itemData.sku = 'SKU-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    itemData.quantity = Number(itemData.quantity) || 0;
    itemData.min_limit = Number.isFinite(Number(itemData.min_limit)) && itemData.min_limit !== '' ? Number(itemData.min_limit) : 5;
    itemData.reorder_qty = Number.isFinite(Number(itemData.reorder_qty)) && itemData.reorder_qty !== '' ? Number(itemData.reorder_qty) : 10;
    itemData.cost_price = Number(itemData.cost_price) || 0;
    itemData.condition = VALID_CONDITIONS.includes(itemData.condition) ? itemData.condition : CONFIG.DEFAULT_CONDITION;
    itemData.condition_note = (itemData.condition_note || '').trim();
    // حقول محسوبة/مرتبطة لا تُرسل لقاعدة البيانات
    delete itemData.status; delete itemData.categories; delete itemData.suppliers;

    if (supabaseClient) {
      if (itemData.id) {
        const { data, error } = await supabaseClient.from('items').update(itemData).eq('id', itemData.id).select().single();
        if (error) throw error;
        triggerRealtime('items', { event: 'UPDATE', record: data });
        return data;
      } else {
        const { data, error } = await supabaseClient.from('items').insert([itemData]).select().single();
        if (error) throw error;
        triggerRealtime('items', { event: 'INSERT', record: data });
        return data;
      }
    }

    // محلياً
    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    let savedItem;

    if (itemData.id) {
      const idx = items.findIndex(i => i.id === itemData.id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...itemData, updated_at: new Date().toISOString() };
        savedItem = items[idx];
      }
    } else {
      savedItem = {
        ...itemData,
        id: 'itm-' + Date.now(),
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      items.push(savedItem);
    }

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    triggerRealtime('items', { event: itemData.id ? 'UPDATE' : 'INSERT', record: savedItem });
    return savedItem;
  },

  async archiveItem(id, isArchived = true) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('items').update({ is_archived: isArchived }).eq('id', id).select().single();
      if (error) throw error;
      triggerRealtime('items', { event: 'UPDATE', record: data });
      return data;
    }

    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const item = items.find(i => i.id === id);
    if (item) {
      item.is_archived = isArchived;
      item.updated_at = new Date().toISOString();
      localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
      triggerRealtime('items', { event: 'UPDATE', record: item });
    }
    return item;
  },

  // تغيير حالة المنتج بسرعة (جيد / متوسط / سيئ) مع ملاحظة اختيارية
  async setItemCondition(id, condition, note) {
    if (!VALID_CONDITIONS.includes(condition)) throw new Error('حالة غير صالحة');
    const patch = { condition };
    if (note !== undefined) patch.condition_note = note;
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('items').update(patch).eq('id', id).select().single();
      if (error) throw error;
      triggerRealtime('items', { event: 'UPDATE', record: data });
      return data;
    }
    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const item = items.find(i => i.id === id);
    if (!item) throw new Error('الصنف غير موجود');
    Object.assign(item, patch, { updated_at: new Date().toISOString() });
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    triggerRealtime('items', { event: 'UPDATE', record: item });
    return item;
  },

  async restoreItem(id) {
    return this.archiveItem(id, false);
  },

  async deleteItem(id, permanent = false) {
    if (permanent) {
      if (supabaseClient) {
        // حذف الحركات المرتبطة أولاً لتجنب قيد ON DELETE RESTRICT
        try {
          await supabaseClient.from('stock_movements').delete().eq('item_id', id);
        } catch (e) {
          console.warn('Could not cascade delete movements:', e);
        }
        const { error } = await supabaseClient.from('items').delete().eq('id', id);
        if (error) throw error;
        triggerRealtime('items', { event: 'DELETE', id });
        return { success: true, permanent: true };
      }

      // محلياً في وضع العرض والتجربة
      let items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
      items = items.filter(i => i.id !== id);
      localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));

      let movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');
      movements = movements.filter(m => m.item_id !== id);
      localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(movements));

      triggerRealtime('items', { event: 'DELETE', id });
      return { success: true, permanent: true };
    } else {
      const res = await this.archiveItem(id, true);
      return { success: true, archived: true, item: res };
    }
  },

  // --------------------------------------------------------------------------
  // RPC (1): تعديل سريع للكمية ذرياً (adjust_stock)
  // --------------------------------------------------------------------------
  async adjustStock(itemId, changeAmount, type, reason = '', createdBy = 'editor') {
    changeAmount = Number(changeAmount);
    if (isNaN(changeAmount) || changeAmount === 0) {
      throw new Error('يرجى تحديد كمية تغيير صالحة');
    }

    if (supabaseClient) {
      const { data, error } = await supabaseClient.rpc('adjust_stock', {
        p_item_id: itemId,
        p_change_amount: changeAmount,
        p_type: type,
        p_reason: reason,
        p_created_by: createdBy
      });
      if (error) throw new Error(error.message);
      triggerRealtime('items', { event: 'UPDATE', itemId });
      triggerRealtime('stock_movements', { event: 'INSERT' });
      return data;
    }

    // المعالجة المحلية الذرية
    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');

    const item = items.find(i => i.id === itemId);
    if (!item) throw new Error('الصنف غير موجود');

    const newQty = item.quantity + changeAmount;
    if (newQty < 0) {
      throw new Error(`لا يمكن إتمام العملية: الكمية الناتجة سالبة (${newQty})`);
    }

    const beforeQty = item.quantity;
    item.quantity = newQty;
    item.updated_at = new Date().toISOString();

    const newMovement = {
      id: 'mov-' + Date.now(),
      item_id: itemId,
      quantity_before: beforeQty,
      quantity_after: newQty,
      change_amount: changeAmount,
      type: type,
      reason: reason || 'تعديل يدوي',
      created_by: createdBy,
      created_at: new Date().toISOString()
    };

    movements.unshift(newMovement);

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(movements));

    triggerRealtime('items', { event: 'UPDATE', record: item });
    triggerRealtime('stock_movements', { event: 'INSERT', record: newMovement });

    return {
      success: true,
      item_id: itemId,
      quantity_before: beforeQty,
      quantity_after: newQty,
      change_amount: changeAmount,
      movement_id: newMovement.id
    };
  },

  // --------------------------------------------------------------------------
  // RPC (2): التراجع عن آخر حركة (undo_movement)
  // --------------------------------------------------------------------------
  async undoMovement(movementId, createdBy = 'editor') {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.rpc('undo_movement', {
        p_movement_id: movementId,
        p_created_by: createdBy
      });
      if (error) throw new Error(error.message);
      triggerRealtime('items', { event: 'UPDATE' });
      triggerRealtime('stock_movements', { event: 'INSERT' });
      return data;
    }

    const movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');
    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');

    const mov = movements.find(m => m.id === movementId);
    if (!mov) throw new Error('الحركة المطلوب التراجع عنها غير موجودة');

    const item = items.find(i => i.id === mov.item_id);
    if (!item) throw new Error('صنف الحركة غير موجود');

    const inverseAmount = -mov.change_amount;
    const newQty = item.quantity + inverseAmount;

    if (newQty < 0) {
      throw new Error(`لا يمكن التراجع: العملية العكسية ستجعل رصيد الصنف سالباً (${newQty})`);
    }

    const beforeQty = item.quantity;
    item.quantity = newQty;
    item.updated_at = new Date().toISOString();

    const compensatingMov = {
      id: 'mov-' + Date.now(),
      item_id: mov.item_id,
      quantity_before: beforeQty,
      quantity_after: newQty,
      change_amount: inverseAmount,
      type: 'correction',
      reason: `تراجع عن حركة سابقة (${mov.reason || mov.type})`,
      reference_id: movementId,
      created_by: createdBy,
      created_at: new Date().toISOString()
    };

    movements.unshift(compensatingMov);

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(movements));

    triggerRealtime('items', { event: 'UPDATE', record: item });
    triggerRealtime('stock_movements', { event: 'INSERT', record: compensatingMov });

    return {
      success: true,
      original_movement_id: movementId,
      compensating_movement_id: compensatingMov.id,
      new_quantity: newQty
    };
  },

  // --------------------------------------------------------------------------
  // RPC (3): اعتماد الجرد الدوري ذرياً (apply_stocktake)
  // --------------------------------------------------------------------------
  async applyStocktake(stocktakeId, lines, notes = '', createdBy = 'editor') {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.rpc('apply_stocktake', {
        p_stocktake_id: stocktakeId,
        p_lines: lines,
        p_notes: notes,
        p_created_by: createdBy
      });
      if (error) throw new Error(error.message);
      triggerRealtime('items', { event: 'UPDATE' });
      triggerRealtime('stocktakes', { event: 'UPDATE' });
      return data;
    }

    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');
    const stocktakes = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_STOCKTAKES) || '[]');

    let updatedCount = 0;
    let discrepancyCount = 0;

    for (const line of lines) {
      const item = items.find(i => i.id === line.item_id);
      if (item) {
        const actual = Number(line.actual_quantity);
        const diff = actual - item.quantity;

        if (diff !== 0) {
          discrepancyCount++;
          const before = item.quantity;
          item.quantity = actual;
          item.updated_at = new Date().toISOString();

          movements.unshift({
            id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
            item_id: item.id,
            quantity_before: before,
            quantity_after: actual,
            change_amount: diff,
            type: 'stocktake',
            reason: `تسوية جرد دوري: ${line.notes || notes || 'مطابقة الجرد الفعلي'}`,
            reference_id: stocktakeId,
            created_by: createdBy,
            created_at: new Date().toISOString()
          });
        }
        updatedCount++;
      }
    }

    // حفظ الجرد
    stocktakes.unshift({
      id: stocktakeId,
      title: 'جرد دوري ' + new Date().toLocaleDateString('ar-EG'),
      status: 'completed',
      notes,
      total_items_counted: updatedCount,
      discrepancy_count: discrepancyCount,
      completed_at: new Date().toISOString(),
      created_by: createdBy,
      created_at: new Date().toISOString(),
      lines
    });

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(movements));
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_STOCKTAKES, JSON.stringify(stocktakes));

    triggerRealtime('items', { event: 'UPDATE' });
    triggerRealtime('stocktakes', { event: 'INSERT' });

    return {
      success: true,
      stocktake_id: stocktakeId,
      items_processed: updatedCount,
      discrepancies: discrepancyCount
    };
  },

  // --------------------------------------------------------------------------
  // RPC (4): تطبيق قالب شغل واستهلاك مجمّع (apply_job_template)
  // --------------------------------------------------------------------------
  async applyJobTemplate(templateId, multiplier = 1, createdBy = 'editor') {
    multiplier = Number(multiplier) || 1;
    if (multiplier <= 0) throw new Error('العدد المطلوب يجب أن يكون أكبر من الصفر');

    if (supabaseClient) {
      const { data, error } = await supabaseClient.rpc('apply_job_template', {
        p_template_id: templateId,
        p_multiplier: multiplier,
        p_created_by: createdBy
      });
      if (error) throw new Error(error.message);
      triggerRealtime('items', { event: 'UPDATE' });
      triggerRealtime('stock_movements', { event: 'INSERT' });
      return data;
    }

    const templates = await this.getJobTemplates();
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) throw new Error('قالب الشغل غير موجود');

    const items = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS) || '[]');
    const movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');

    // 1) فحص توفر جميع الأصناف أولاً
    for (const line of tpl.lines) {
      const needed = line.quantity * multiplier;
      const item = items.find(i => i.id === line.item_id);
      if (!item) throw new Error('صنف من القالب غير موجود في المخزون');
      if (item.quantity < needed) {
        throw new Error(`رصيد غير كافٍ للصنف (${item.name}): المتوفر ${item.quantity} والمطلوب ${needed}`);
      }
    }

    // 2) الخصم وتسجيل الحركات
    for (const line of tpl.lines) {
      const needed = line.quantity * multiplier;
      const item = items.find(i => i.id === line.item_id);
      const before = item.quantity;
      item.quantity -= needed;
      item.updated_at = new Date().toISOString();

      movements.unshift({
        id: 'mov-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
        item_id: item.id,
        quantity_before: before,
        quantity_after: item.quantity,
        change_amount: -needed,
        type: 'job_template',
        reason: `استهلاك شغل: ${tpl.name} (عدد ${multiplier})`,
        reference_id: templateId,
        created_by: createdBy,
        created_at: new Date().toISOString()
      });
    }

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(items));
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(movements));

    triggerRealtime('items', { event: 'UPDATE' });
    triggerRealtime('stock_movements', { event: 'INSERT' });

    return {
      success: true,
      template_name: tpl.name,
      multiplier
    };
  },

  // --------------------------------------------------------------------------
  // التصنيفات والموردين وقوالب الشغل وسجل الحركات
  // --------------------------------------------------------------------------
  async getCategories() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('categories').select('*').order('sort_order');
      if (error) throw error;
      return data;
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_CATEGORIES) || '[]');
  },

  async saveCategory(name, description = '') {
    if (!name?.trim()) throw new Error('اسم التصنيف مطلوب');
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('categories').insert([{ name: name.trim(), description }]).select().single();
      if (error) throw error;
      return data;
    }
    const categories = await this.getCategories();
    const newCat = { id: 'cat-' + Date.now(), name: name.trim(), description, sort_order: categories.length + 1 };
    categories.push(newCat);
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_CATEGORIES, JSON.stringify(categories));
    return newCat;
  },

  async getSuppliers() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('suppliers').select('*').order('name');
      if (error) throw error;
      return data;
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_SUPPLIERS) || '[]');
  },

  async saveSupplier(supData) {
    if (!supData.name?.trim()) throw new Error('اسم المورد مطلوب');
    if (supabaseClient) {
      if (supData.id) {
        const { data, error } = await supabaseClient.from('suppliers').update(supData).eq('id', supData.id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabaseClient.from('suppliers').insert([supData]).select().single();
      if (error) throw error;
      return data;
    }
    const suppliers = await this.getSuppliers();
    if (supData.id) {
      const idx = suppliers.findIndex(s => s.id === supData.id);
      if (idx !== -1) suppliers[idx] = { ...suppliers[idx], ...supData };
    } else {
      suppliers.push({ ...supData, id: 'sup-' + Date.now() });
    }
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_SUPPLIERS, JSON.stringify(suppliers));
    return supData;
  },

  async getJobTemplates() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('job_templates').select('*, lines:job_template_lines(*, items(name))');
      if (error) throw error;
      return data;
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_TEMPLATES) || '[]');
  },

  async saveJobTemplate(template) {
    if (!template.name?.trim()) throw new Error('اسم القالب مطلوب');
    if (!template.lines || template.lines.length === 0) throw new Error('يجب إضافة صنف واحد على الأقل للقالب');

    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('job_templates').insert([{ name: template.name, description: template.description }]).select().single();
      if (error) throw error;
      const lines = template.lines.map(l => ({ template_id: data.id, item_id: l.item_id, quantity: l.quantity }));
      await supabaseClient.from('job_template_lines').insert(lines);
      return data;
    }

    const templates = await this.getJobTemplates();
    const newTpl = {
      ...template,
      id: template.id || 'tpl-' + Date.now()
    };
    if (template.id) {
      const idx = templates.findIndex(t => t.id === template.id);
      if (idx !== -1) templates[idx] = newTpl;
    } else {
      templates.push(newTpl);
    }
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_TEMPLATES, JSON.stringify(templates));
    return newTpl;
  },

  async getMovements(limit = 100) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('stock_movements').select('*, items(name, sku, unit)').order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data;
    }

    const movements = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS) || '[]');
    const items = await this.getItems(true);
    const itemMap = new Map(items.map(i => [i.id, i]));

    return movements.slice(0, limit).map(m => {
      const itm = itemMap.get(m.item_id);
      return {
        ...m,
        items: itm ? { name: itm.name, sku: itm.sku, unit: itm.unit } : { name: 'صنف محذوف', sku: '', unit: '' }
      };
    });
  },

  async getStocktakes() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('stocktakes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_STOCKTAKES) || '[]');
  },

  // --------------------------------------------------------------------------
  // الإعدادات (Settings)
  // --------------------------------------------------------------------------
  async getSettings() {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('settings').select('*').eq('id', 'global').single();
      if (!error && data) return data;
    }
    return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.LOCAL_SETTINGS) || JSON.stringify(SEED_DATA.settings));
  },

  async updateSettings(newSettings) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('settings').update(newSettings).eq('id', 'global').select().single();
      if (error) throw error;
      triggerRealtime('settings', { event: 'UPDATE', record: data });
      return data;
    }
    const current = await this.getSettings();
    const updated = { ...current, ...newSettings };
    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_SETTINGS, JSON.stringify(updated));
    triggerRealtime('settings', { event: 'UPDATE', record: updated });
    return updated;
  },

  // تصدير نسخة احتياطية كاملة (JSON)
  async exportFullBackup() {
    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      settings: await this.getSettings(),
      categories: await this.getCategories(),
      suppliers: await this.getSuppliers(),
      items: await this.getItems(true),
      movements: await this.getMovements(1000),
      job_templates: await this.getJobTemplates(),
      stocktakes: await this.getStocktakes(),
    };
    return backup;
  },

  // استيراد نسخة احتياطية (JSON)
  async importFullBackup(backupData) {
    if (!backupData || !Array.isArray(backupData.items)) {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو تالف');
    }
    if (supabaseClient) {
      throw new Error('الاستعادة من ملف متاحة في الوضع المحلي فقط. افصل ربط Supabase مؤقتا أو استورد من لوحة Supabase.');
    }

    localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_ITEMS, JSON.stringify(backupData.items));
    if (backupData.categories) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_CATEGORIES, JSON.stringify(backupData.categories));
    if (backupData.suppliers) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_SUPPLIERS, JSON.stringify(backupData.suppliers));
    if (backupData.movements) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_MOVEMENTS, JSON.stringify(backupData.movements));
    if (backupData.job_templates) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_TEMPLATES, JSON.stringify(backupData.job_templates));
    if (backupData.stocktakes) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_STOCKTAKES, JSON.stringify(backupData.stocktakes));
    if (backupData.settings) localStorage.setItem(CONFIG.STORAGE_KEYS.LOCAL_SETTINGS, JSON.stringify(backupData.settings));

    triggerRealtime('items', { event: 'ALL' });
    return true;
  }
};
