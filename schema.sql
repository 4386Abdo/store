-- ============================================================================
-- نظام إدارة مخزون استوديو التصوير والطباعة وتغليف الألبومات
-- ملف إنشاء الجداول والدوال وصلاحيات RLS والبيانات الأولية (Supabase PostgreSQL)
-- ============================================================================

-- تمكين ملحق التوليد العشوائي للمفاتيح (UUID)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. جدول الإعدادات العامة (Settings)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settings (
    id TEXT PRIMARY KEY DEFAULT 'global',
    currency TEXT NOT NULL DEFAULT 'ج.م',
    default_min_threshold INTEGER NOT NULL DEFAULT 5,
    hide_cost_from_owner BOOLEAN NOT NULL DEFAULT FALSE,
    require_viewer_pin BOOLEAN NOT NULL DEFAULT FALSE,
    inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 15,
    max_failed_attempts INTEGER NOT NULL DEFAULT 5,
    lockout_minutes INTEGER NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- ----------------------------------------------------------------------------
-- 2. جدول التصنيفات (Categories)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- ----------------------------------------------------------------------------
-- 3. جدول الموردين (Suppliers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- ----------------------------------------------------------------------------
-- 4. جدول الأصناف (Items)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    specs TEXT DEFAULT '', -- المقاس أو المواصفات مثل: 10×15 سم، 260 جرام، كرتون 2 مم
    unit TEXT NOT NULL DEFAULT 'قطعة', -- قطعة / علبة / رزمة / متر / لتر
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    min_limit NUMERIC(10, 2) NOT NULL DEFAULT 5 CHECK (min_limit >= 0),
    reorder_qty NUMERIC(10, 2) NOT NULL DEFAULT 10 CHECK (reorder_qty >= 0),
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    cost_price NUMERIC(10, 2) DEFAULT 0 CHECK (cost_price >= 0),
    last_purchase_price NUMERIC(10, 2) DEFAULT 0 CHECK (last_purchase_price >= 0),
    storage_location TEXT DEFAULT '', -- مكان التخزين: رف أ-1، درج الأحبار، مخزن الألبومات
    notes TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    expiry_date DATE DEFAULT NULL, -- تاريخ الصلاحية للأحبار والخامات الحساسة
    condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'poor')), -- حالة المنتج: جيد / متوسط / سيئ
    condition_note TEXT DEFAULT '',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- للقواعد المنشأة سابقا: إضافة أعمدة حالة المنتج (آمن لو شُغّل أكثر من مرة)
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'good';
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS condition_note TEXT DEFAULT '';
DO $$ BEGIN
  ALTER TABLE public.items ADD CONSTRAINT items_condition_check CHECK (condition IN ('good', 'fair', 'poor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- فهارس لتحسين سرعة البحث والفلترة
CREATE INDEX IF NOT EXISTS idx_items_sku ON public.items(sku);
CREATE INDEX IF NOT EXISTS idx_items_category ON public.items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_quantity ON public.items(quantity);
CREATE INDEX IF NOT EXISTS idx_items_archived ON public.items(is_archived);

-- ----------------------------------------------------------------------------
-- 5. جدول سجل الحركات (Stock Movements) - سجل غير قابل للتعديل أو الحذف
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
    quantity_before NUMERIC(10, 2) NOT NULL,
    quantity_after NUMERIC(10, 2) NOT NULL,
    change_amount NUMERIC(10, 2) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('supply', 'consume', 'damage', 'stocktake', 'correction', 'job_template')),
    reason TEXT NOT NULL DEFAULT '',
    reference_id TEXT DEFAULT NULL, -- معرف مرجعي للجرد أو القالب
    created_by TEXT DEFAULT 'editor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

CREATE INDEX IF NOT EXISTS idx_movements_item ON public.stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON public.stock_movements(created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. جدول عمليات الجرد الدوري (Stocktakes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stocktakes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    notes TEXT DEFAULT '',
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    total_items_counted INTEGER DEFAULT 0,
    discrepancy_count INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ DEFAULT NULL,
    created_by TEXT DEFAULT 'editor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- بنود الجرد
CREATE TABLE IF NOT EXISTS public.stocktake_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stocktake_id UUID NOT NULL REFERENCES public.stocktakes(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
    recorded_quantity NUMERIC(10, 2) NOT NULL,
    actual_quantity NUMERIC(10, 2) NOT NULL,
    diff_quantity NUMERIC(10, 2) GENERATED ALWAYS AS (actual_quantity - recorded_quantity) STORED,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- ----------------------------------------------------------------------------
-- 7. قوالب الشغل (Job Templates) للاستهلاك المجمّع
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('Africa/Cairo', now())
);

-- بنود كل قالب
CREATE TABLE IF NOT EXISTS public.job_template_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES public.job_templates(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
    quantity NUMERIC(10, 2) NOT NULL CHECK (quantity > 0)
);

-- ----------------------------------------------------------------------------
-- 8. التحديث التلقائي للوقت (Trigger: updated_at)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('Africa/Cairo', now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_items_updated_at
BEFORE UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE OR REPLACE TRIGGER trg_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE OR REPLACE TRIGGER trg_settings_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ----------------------------------------------------------------------------
-- 9. دوال RPC المدارة بصلاحيات أمان صارمة ومعاملات ذرية (Transactions)
-- ----------------------------------------------------------------------------

-- دالة (1): تعديل الكمية وتسجيل الحركة ذرياً (adjust_stock)
CREATE OR REPLACE FUNCTION adjust_stock(
    p_item_id UUID,
    p_change_amount NUMERIC,
    p_type TEXT,
    p_reason TEXT DEFAULT '',
    p_created_by TEXT DEFAULT 'editor'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
    v_new_qty NUMERIC;
    v_movement_id UUID;
BEGIN
    -- قفل السطر لمنع تضارب العمليات المتزامنة
    SELECT * INTO v_item FROM public.items WHERE id = p_item_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الصنف المطلوب غير موجود';
    END IF;

    v_new_qty := v_item.quantity + p_change_amount;

    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'لا يمكن إتمام العملية: الكمية الناتجة سالبة (% < 0)', v_new_qty;
    END IF;

    -- تحديث كمية الصنف
    UPDATE public.items
    SET quantity = v_new_qty,
        updated_at = timezone('Africa/Cairo', now())
    WHERE id = p_item_id;

    -- تسجيل الحركة في السجل غير القابل للتعديل
    INSERT INTO public.stock_movements (
        item_id,
        quantity_before,
        quantity_after,
        change_amount,
        type,
        reason,
        created_by
    ) VALUES (
        p_item_id,
        v_item.quantity,
        v_new_qty,
        p_change_amount,
        p_type,
        COALESCE(p_reason, 'تعديل يدوي'),
        p_created_by
    ) RETURNING id INTO v_movement_id;

    RETURN jsonb_build_object(
        'success', true,
        'item_id', p_item_id,
        'quantity_before', v_item.quantity,
        'quantity_after', v_new_qty,
        'change_amount', p_change_amount,
        'movement_id', v_movement_id
    );
END;
$$;

-- دالة (2): اعتماد الجرد الدوري ذرياً (apply_stocktake)
CREATE OR REPLACE FUNCTION apply_stocktake(
    p_stocktake_id UUID,
    p_lines JSONB,
    p_notes TEXT DEFAULT '',
    p_created_by TEXT DEFAULT 'editor'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_line JSONB;
    v_item_id UUID;
    v_actual_qty NUMERIC;
    v_item RECORD;
    v_diff NUMERIC;
    v_updated_count INT := 0;
    v_discrepancy_count INT := 0;
BEGIN
    -- معالجة كل بند من بنود الجرد
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_item_id := (v_line->>'item_id')::UUID;
        v_actual_qty := (v_line->>'actual_quantity')::NUMERIC;

        IF v_actual_qty < 0 THEN
            RAISE EXCEPTION 'الكمية الفعلية لا يمكن أن تكون سالبة للصنف %', v_item_id;
        END IF;

        SELECT * INTO v_item FROM public.items WHERE id = v_item_id FOR UPDATE;
        
        IF FOUND THEN
            v_diff := v_actual_qty - v_item.quantity;
            
            -- حفظ البند في جدول بنود الجرد
            INSERT INTO public.stocktake_lines (
                stocktake_id,
                item_id,
                recorded_quantity,
                actual_quantity,
                notes
            ) VALUES (
                p_stocktake_id,
                v_item_id,
                v_item.quantity,
                v_actual_qty,
                COALESCE(v_line->>'notes', '')
            );

            -- لو في فرق، نسجل حركة تعديل جرد ونحدث الصنف
            IF v_diff <> 0 THEN
                v_discrepancy_count := v_discrepancy_count + 1;

                UPDATE public.items
                SET quantity = v_actual_qty,
                    updated_at = timezone('Africa/Cairo', now())
                WHERE id = v_item_id;

                INSERT INTO public.stock_movements (
                    item_id,
                    quantity_before,
                    quantity_after,
                    change_amount,
                    type,
                    reason,
                    reference_id,
                    created_by
                ) VALUES (
                    v_item_id,
                    v_item.quantity,
                    v_actual_qty,
                    v_diff,
                    'stocktake',
                    'تسوية جرد دوري رقم: ' || p_stocktake_id,
                    p_stocktake_id::TEXT,
                    p_created_by
                );
            END IF;

            v_updated_count := v_updated_count + 1;
        END IF;
    END LOOP;

    -- تحديث حالة الجرد
    UPDATE public.stocktakes
    SET status = 'completed',
        total_items_counted = v_updated_count,
        discrepancy_count = v_discrepancy_count,
        notes = p_notes,
        completed_at = timezone('Africa/Cairo', now())
    WHERE id = p_stocktake_id;

    RETURN jsonb_build_object(
        'success', true,
        'stocktake_id', p_stocktake_id,
        'items_processed', v_updated_count,
        'discrepancies', v_discrepancy_count
    );
END;
$$;

-- دالة (3): تطبيق قالب شغل واستهلاك مجمّع (apply_job_template)
CREATE OR REPLACE FUNCTION apply_job_template(
    p_template_id UUID,
    p_multiplier NUMERIC DEFAULT 1,
    p_created_by TEXT DEFAULT 'editor'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_template RECORD;
    v_line RECORD;
    v_item RECORD;
    v_needed NUMERIC;
    v_deducted_items JSONB := '[]'::JSONB;
BEGIN
    SELECT * INTO v_template FROM public.job_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'قالب الشغل المطلوب غير موجود';
    END IF;

    IF p_multiplier <= 0 THEN
        RAISE EXCEPTION 'معامل التكرار يجب أن يكون أكبر من الصفر';
    END IF;

    -- خطوة أولى: التحقق المسبق من توفر جميع بنود القالب قبل خصم أي بند
    FOR v_line IN SELECT * FROM public.job_template_lines WHERE template_id = p_template_id
    LOOP
        v_needed := v_line.quantity * p_multiplier;
        SELECT * INTO v_item FROM public.items WHERE id = v_line.item_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'أحد أصناف القالب غير موجود بالمخزون';
        END IF;

        IF v_item.quantity < v_needed THEN
            RAISE EXCEPTION 'رصيد غير كافٍ للصنف (%): المتوفر % والمطلوب %', v_item.name, v_item.quantity, v_needed;
        END IF;
    END LOOP;

    -- خطوة ثانية: خصم جميع البنود وتسجيل الحركات
    FOR v_line IN SELECT * FROM public.job_template_lines WHERE template_id = p_template_id
    LOOP
        v_needed := v_line.quantity * p_multiplier;
        SELECT * INTO v_item FROM public.items WHERE id = v_line.item_id FOR UPDATE;

        UPDATE public.items
        SET quantity = quantity - v_needed,
            updated_at = timezone('Africa/Cairo', now())
        WHERE id = v_line.item_id;

        INSERT INTO public.stock_movements (
            item_id,
            quantity_before,
            quantity_after,
            change_amount,
            type,
            reason,
            reference_id,
            created_by
        ) VALUES (
            v_line.item_id,
            v_item.quantity,
            v_item.quantity - v_needed,
            -v_needed,
            'job_template',
            'استهلاك شغل: ' || v_template.name || ' (عدد ' || p_multiplier || ')',
            p_template_id::TEXT,
            p_created_by
        );

        v_deducted_items := v_deducted_items || jsonb_build_object(
            'item_id', v_line.item_id,
            'item_name', v_item.name,
            'deducted', v_needed,
            'remaining', v_item.quantity - v_needed
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'template_name', v_template.name,
        'multiplier', p_multiplier,
        'deductions', v_deducted_items
    );
END;
$$;

-- دالة (4): التراجع عن آخر حركة (undo_movement)
CREATE OR REPLACE FUNCTION undo_movement(
    p_movement_id UUID,
    p_created_by TEXT DEFAULT 'editor'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_mov RECORD;
    v_item RECORD;
    v_inverse_amount NUMERIC;
    v_new_qty NUMERIC;
    v_new_movement_id UUID;
BEGIN
    SELECT * INTO v_mov FROM public.stock_movements WHERE id = p_movement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الحركة المطلوب التراجع عنها غير موجودة';
    END IF;

    SELECT * INTO v_item FROM public.items WHERE id = v_mov.item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الصنف الخاص بهذه الحركة غير موجود';
    END IF;

    -- الحركة العكسية
    v_inverse_amount := -v_mov.change_amount;
    v_new_qty := v_item.quantity + v_inverse_amount;

    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'لا يمكن التراجع: العملية العكسية ستجعل رصيد الصنف سالباً (%)', v_new_qty;
    END IF;

    UPDATE public.items
    SET quantity = v_new_qty,
        updated_at = timezone('Africa/Cairo', now())
    WHERE id = v_mov.item_id;

    -- تسجيل حركة تصحيحية جديدة مسجلة كحركة منفصلة وليس كحذف
    INSERT INTO public.stock_movements (
        item_id,
        quantity_before,
        quantity_after,
        change_amount,
        type,
        reason,
        reference_id,
        created_by
    ) VALUES (
        v_mov.item_id,
        v_item.quantity,
        v_new_qty,
        v_inverse_amount,
        'correction',
        'تراجع عن حركة سابقة رقم: ' || p_movement_id,
        p_movement_id::TEXT,
        p_created_by
    ) RETURNING id INTO v_new_movement_id;

    RETURN jsonb_build_object(
        'success', true,
        'item_id', v_mov.item_id,
        'original_movement_id', p_movement_id,
        'compensating_movement_id', v_new_movement_id,
        'new_quantity', v_new_qty
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. واجهات العرض (Views) المخصصة لواجهة المالك بدون الأعمدة الحساسة
-- ----------------------------------------------------------------------------

-- واجهة الأصناف لصاحب الاستوديو
CREATE OR REPLACE VIEW public.owner_items_view AS
SELECT 
    i.id,
    i.sku,
    i.name,
    c.name AS category_name,
    i.specs,
    i.unit,
    i.quantity,
    i.min_limit,
    i.reorder_qty,
    i.storage_location,
    i.notes,
    i.image_url,
    i.expiry_date,
    CASE 
        WHEN i.quantity <= 0 THEN 'out_of_stock'
        WHEN i.quantity <= i.min_limit THEN 'low'
        ELSE 'available'
    END AS status,
    -- إظهار التكلفة فقط إذا كان خيار الإخفاء غير مفعل في جدول الإعدادات
    CASE 
        WHEN (SELECT hide_cost_from_owner FROM public.settings WHERE id = 'global') = TRUE THEN NULL
        ELSE i.cost_price
    END AS cost_price,
    CASE 
        WHEN (SELECT hide_cost_from_owner FROM public.settings WHERE id = 'global') = TRUE THEN NULL
        ELSE (i.cost_price * i.quantity)
    END AS total_valuation,
    i.updated_at
FROM public.items i
LEFT JOIN public.categories c ON i.category_id = c.id
WHERE i.is_archived = FALSE;

-- واجهة حساب معدل الاستهلاك ومتوسط الأيام المتوقعة قبل النفاد
CREATE OR REPLACE VIEW public.owner_items_with_days_view AS
WITH consumption_30_days AS (
    SELECT 
        item_id,
        ABS(SUM(change_amount)) AS total_consumed
    FROM public.stock_movements
    WHERE change_amount < 0
      AND type IN ('consume', 'job_template')
      AND created_at >= (timezone('Africa/Cairo', now()) - INTERVAL '30 days')
    GROUP BY item_id
)
SELECT 
    v.*,
    COALESCE(c.total_consumed, 0) AS consumed_last_30_days,
    ROUND(COALESCE(c.total_consumed, 0) / 30.0, 2) AS daily_consumption_rate,
    CASE 
        WHEN v.quantity <= 0 THEN 0
        WHEN COALESCE(c.total_consumed, 0) > 0 THEN 
            ROUND(v.quantity / (c.total_consumed / 30.0))
        ELSE NULL -- لا توجد حركات استهلاك كافية لتوقع النفاد
    END AS estimated_days_remaining
FROM public.owner_items_view v
LEFT JOIN consumption_30_days c ON v.id = c.item_id;

-- ----------------------------------------------------------------------------
-- 11. سياسات الأمان على مستوى الصفوف (Row Level Security - RLS)
-- ----------------------------------------------------------------------------

-- تفعيل RLS على جميع الجداول
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stocktake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_template_lines ENABLE ROW LEVEL SECURITY;

-- دوال للتحقق من هوية وصلاحية المستخدم
CREATE OR REPLACE FUNCTION public.is_editor()
RETURNS BOOLEAN AS $$
BEGIN
    -- المستخدم يعتبر محرراً إذا كان مسجل دخول ومطابق لإيميل المحرر
    -- أو لديه role = 'editor' في jwt metadata
    RETURN (
        auth.role() = 'authenticated' AND (
            auth.jwt() ->> 'email' LIKE '%editor%' OR
            (auth.jwt() -> 'user_metadata' ->> 'role') = 'editor' OR
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'editor' OR
            auth.uid() IS NOT NULL
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- سياسات جدول الإعدادات:
-- القراءة متاحة للجميع لمعرفة اسم الاستوديو وحالة إخفاء الأسعار
CREATE POLICY "settings_public_read" ON public.settings
    FOR SELECT USING (true);

-- التعديل للمسؤول فقط
CREATE POLICY "settings_editor_all" ON public.settings
    FOR ALL TO authenticated
    USING (public.is_editor())
    WITH CHECK (public.is_editor());

-- سياسات جدول الأصناف:
-- القراءة متاحة للجميع (أو للمسؤول وصاحب الاستوديو)
CREATE POLICY "items_select_policy" ON public.items
    FOR SELECT USING (true);

-- التعديل والإضافة والحذف للمسؤول فقط
CREATE POLICY "items_editor_insert" ON public.items
    FOR INSERT TO authenticated
    WITH CHECK (public.is_editor());

CREATE POLICY "items_editor_update" ON public.items
    FOR UPDATE TO authenticated
    USING (public.is_editor())
    WITH CHECK (public.is_editor());

CREATE POLICY "items_editor_delete" ON public.items
    FOR DELETE TO authenticated
    USING (public.is_editor());

-- سياسات الحركات: القراءة متاحة، والإضافة للمسؤول فقط، والحذف/التعديل ممنوع تماماً
CREATE POLICY "movements_select_policy" ON public.stock_movements
    FOR SELECT USING (true);

CREATE POLICY "movements_insert_policy" ON public.stock_movements
    FOR INSERT TO authenticated
    WITH CHECK (public.is_editor());

-- سياسات التصنيفات والموردين والقوالب
CREATE POLICY "categories_read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories_editor_all" ON public.categories FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

CREATE POLICY "suppliers_read" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "suppliers_editor_all" ON public.suppliers FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

CREATE POLICY "stocktakes_read" ON public.stocktakes FOR SELECT USING (true);
CREATE POLICY "stocktakes_editor_all" ON public.stocktakes FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

CREATE POLICY "stocktake_lines_read" ON public.stocktake_lines FOR SELECT USING (true);
CREATE POLICY "stocktake_lines_editor_all" ON public.stocktake_lines FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

CREATE POLICY "job_templates_read" ON public.job_templates FOR SELECT USING (true);
CREATE POLICY "job_templates_editor_all" ON public.job_templates FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

CREATE POLICY "job_template_lines_read" ON public.job_template_lines FOR SELECT USING (true);
CREATE POLICY "job_template_lines_editor_all" ON public.job_template_lines FOR ALL TO authenticated USING (public.is_editor()) WITH CHECK (public.is_editor());

-- ----------------------------------------------------------------------------
-- 12. تفعيل Realtime في Supabase لتحديث شاشة المالك تلقائياً
-- ----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;

-- ----------------------------------------------------------------------------
-- 13. البيانات الأولية التجريبية الشاملة (Seed Data)
-- ----------------------------------------------------------------------------

-- الإعداد الافتراضي
INSERT INTO public.settings (id, currency, default_min_threshold, hide_cost_from_owner)
VALUES ('global', 'ج.م', 5, false)
ON CONFLICT (id) DO NOTHING;

-- التصنيفات
INSERT INTO public.categories (id, name, description, sort_order) VALUES
('c1000000-0000-0000-0000-000000000001', 'طبعات ومقاسات الصور', 'مقاسات طباعة الصور الفوتوغرافية القياسية', 1),
('c1000000-0000-0000-0000-000000000002', 'ورق طباعة فوتوغرافي', 'رولات وشيتات ورق طباعة لامع ومطفي وكانفاس', 2),
('c1000000-0000-0000-0000-000000000003', 'أحبار طابعات', 'أحبار الطابعات الفوتوغرافية وتانكات الألوان', 3),
('c1000000-0000-0000-0000-000000000004', 'ألبومات تصوير خالية', 'ألبومات بأحجام وأشكال جاهزة للتركيب', 4),
('c1000000-0000-0000-0000-000000000005', 'خامات تجليد وتغليف', 'كرتون، قماش، جلد صناعي، سلوفان حراري، لاصق', 5),
('c1000000-0000-0000-0000-000000000006', 'إطارات وبراويز وشاسيهات', 'براويز خشب وأكريليك وشاسيهات كانفاس', 6)
ON CONFLICT (name) DO NOTHING;

-- الموردين
INSERT INTO public.suppliers (id, name, phone, address, notes) VALUES
('s1000000-0000-0000-0000-000000000001', 'شركة الأهرام للورق والأحبار', '01012345678', 'عابدين - القاهرة', 'مورد رئيسي لأوراق وأحبار إبسون الأصلية'),
('s1000000-0000-0000-0000-000000000002', 'الشركة الدولية لتجليد الألبومات', '01123456789', 'باب الخلق - القاهرة', 'مورد خامات الألبومات والجلود والكرتون المقوى'),
('s1000000-0000-0000-0000-000000000003', 'العالمية للإطارات والشاسيهات', '01234567890', 'العتبة - القاهرة', 'مورد براويز خشب وإطارات مودرن وشاسيهات كانفاس')
ON CONFLICT DO NOTHING;

-- الأصناف
INSERT INTO public.items (
    id, sku, name, category_id, specs, unit, quantity, min_limit, reorder_qty, supplier_id, cost_price, last_purchase_price, storage_location, notes, expiry_date
) VALUES
-- طبعات الصور
('i1000000-0000-0000-0000-000000000001', 'PRN-1015', 'طبعة صورة 10×15 سم', 'c1000000-0000-0000-0000-000000000001', '10×15 سم فوتوغرافي عالي الجودة', 'قطعة', 450, 100, 500, 's1000000-0000-0000-0000-000000000001', 3.50, 3.50, 'درج الطبعات الصغير', 'المقاس الأكثر طلباً للصور التذكارية', NULL),
('i1000000-0000-0000-0000-000000000002', 'PRN-1318', 'طبعة صورة 13×18 سم', 'c1000000-0000-0000-0000-000000000001', '13×18 سم فوتوغرافي لامع', 'قطعة', 180, 50, 200, 's1000000-0000-0000-0000-000000000001', 5.50, 5.50, 'درج الطبعات المتوسط', '', NULL),
('i1000000-0000-0000-0000-000000000003', 'PRN-1521', 'طبعة صورة 15×21 سم (A5)', 'c1000000-0000-0000-0000-000000000001', '15×21 سم فوتوغرافي مطفي وفاخر', 'قطعة', 75, 40, 150, 's1000000-0000-0000-0000-000000000001', 8.00, 8.00, 'درج الطبعات الكبير', 'مقاس مناسب لصفحات الألبومات المتوسطة', NULL),
('i1000000-0000-0000-0000-000000000004', 'PRN-2030', 'طبعة صورة 20×30 سم (A4)', 'c1000000-0000-0000-0000-000000000001', '20×30 سم حريري فائق النعومة', 'قطعة', 25, 20, 50, 's1000000-0000-0000-0000-000000000001', 18.00, 18.00, 'رف الورق المسطح', 'مناسب لشهادات وبراويز الصالون', NULL),
('i1000000-0000-0000-0000-000000000005', 'PRN-3040', 'طبعة صورة 30×40 سم', 'c1000000-0000-0000-0000-000000000001', '30×40 سم لصفحات الألبومات الكبيرة', 'قطعة', 8, 15, 30, 's1000000-0000-0000-0000-000000000001', 35.00, 35.00, 'خزانة الطبعات الكبيرة', 'تحت الحد الأدنى - يلزم طلب عاجل', NULL),
('i1000000-0000-0000-0000-000000000006', 'PRN-4060', 'طبعة بوستر 40×60 سم', 'c1000000-0000-0000-0000-000000000001', '40×60 سم صور بورتريه عرايس', 'قطعة', 3, 5, 15, 's1000000-0000-0000-0000-000000000001', 65.00, 65.00, 'خزانة البوسترات', 'قارب على النفاد', NULL),

-- ورق الطباعة
('i1000000-0000-0000-0000-000000000007', 'PAP-GLS260', 'ورق فوتوغرافي لامع 260 جم', 'c1000000-0000-0000-0000-000000000002', 'رول عرض 61 سم × 30 متر', 'رزمة', 2, 4, 6, 's1000000-0000-0000-0000-000000000001', 420.00, 420.00, 'مستودع الرولات أ', 'قارب على النفاد جداً', NULL),
('i1000000-0000-0000-0000-000000000008', 'PAP-MAT230', 'ورق فوتوغرافي مطفي فاخر 230 جم', 'c1000000-0000-0000-0000-000000000002', 'باكيت 100 ورقة A4', 'علبة', 6, 3, 10, 's1000000-0000-0000-0000-000000000001', 280.00, 280.00, 'رف الخامات 2', '', NULL),
('i1000000-0000-0000-0000-000000000009', 'PAP-CANV', 'رول قماش كانفاس قطني طبيعي', 'c1000000-0000-0000-0000-000000000002', 'عرض 91 سم × 18 متر 380 جم', 'متر', 14, 5, 20, 's1000000-0000-0000-0000-000000000001', 110.00, 110.00, 'مستودع الرولات ب', 'لتابلوهات الزفاف الفاخرة', NULL),

-- أحبار الطابعات
('i1000000-0000-0000-0000-000000000010', 'INK-BLK-EP', 'حبر فوتوغرافي أسود Photo Black', 'c1000000-0000-0000-0000-000000000003', 'عبوة 500 مل لطابعات إبسون L805 / P600', 'علبة', 4, 2, 5, 's1000000-0000-0000-0000-000000000001', 190.00, 190.00, 'خزانة الأحبار الآمنة', 'صلاحية حتى نهاية 2027', '2027-12-31'),
('i1000000-0000-0000-0000-000000000011', 'INK-CYN-EP', 'حبر فوتوغرافي أزرق Cyan', 'c1000000-0000-0000-0000-000000000003', 'عبوة 500 مل', 'علبة', 1, 2, 5, 's1000000-0000-0000-0000-000000000001', 190.00, 190.00, 'خزانة الأحبار الآمنة', 'تحت الحد الأدنى', '2027-12-31'),
('i1000000-0000-0000-0000-000000000012', 'INK-MAG-EP', 'حبر فوتوغرافي أحمر Magenta', 'c1000000-0000-0000-0000-000000000003', 'عبوة 500 مل', 'علبة', 0, 2, 5, 's1000000-0000-0000-0000-000000000001', 190.00, 190.00, 'خزانة الأحبار الآمنة', 'نفد بالكامل!', '2027-12-31'),
('i1000000-0000-0000-0000-000000000013', 'INK-YEL-EP', 'حبر فوتوغرافي أصفر Yellow', 'c1000000-0000-0000-0000-000000000003', 'عبوة 500 مل', 'علبة', 3, 2, 5, 's1000000-0000-0000-0000-000000000001', 190.00, 190.00, 'خزانة الأحبار الآمنة', '', '2027-12-31'),

-- ألبومات خالية
('i1000000-0000-0000-0000-000000000014', 'ALB-3040-LEA', 'ألبوم عرائس جلد فاخر 30×40 سم', 'c1000000-0000-0000-0000-000000000004', 'جلد طبيعي أسود/كحلي 20 صفحة هاردكفر', 'قطعة', 5, 3, 10, 's1000000-0000-0000-0000-000000000002', 380.00, 380.00, 'جناح الألبومات الملكية', 'شامل علبة خشبية مبطنة', NULL),
('i1000000-0000-0000-0000-000000000015', 'ALB-2030-LIN', 'ألبوم خطوبة كتان بيج 20×30 سم', 'c1000000-0000-0000-0000-000000000004', 'قماش كتان مع نافذة أكريليك 15 صفحة', 'قطعة', 8, 4, 12, 's1000000-0000-0000-0000-000000000002', 220.00, 220.00, 'جناح الألبومات المودرن', '', NULL),
('i1000000-0000-0000-0000-000000000016', 'ALB-1521-MINI', 'ميني ألبوم أطفال 15×21 سم', 'c1000000-0000-0000-0000-000000000004', 'غلاف مخمل ناعم وردي/سماوي 10 صفحات', 'قطعة', 12, 5, 20, 's1000000-0000-0000-0000-000000000002', 120.00, 120.00, 'جناح الألبومات المودرن', 'طلب مستمر لمناسبات السبوع وأعياد الميلاد', NULL),

-- خامات تجليد وتغليف
('i1000000-0000-0000-0000-000000000017', 'MAT-GRYB2', 'كرتون مقوى دوبلكس رمادي 2 مم', 'c1000000-0000-0000-0000-000000000005', 'لوح 70×100 سم لكبس صفحات وهيكل الألبوم', 'قطعة', 45, 20, 100, 's1000000-0000-0000-0000-000000000002', 15.00, 15.00, 'مخزن الكرتون المسطح', '', NULL),
('i1000000-0000-0000-0000-000000000018', 'MAT-LEA-SYN', 'رول جلد صناعي للتجليد (أبيض لؤلؤي)', 'c1000000-0000-0000-0000-000000000005', 'عرض 140 سم للمتر الطولي', 'متر', 18, 5, 25, 's1000000-0000-0000-0000-000000000002', 85.00, 85.00, 'حامل الجلود والأقمشة', '', NULL),
('i1000000-0000-0000-0000-000000000019', 'MAT-GLUE-BND', 'غراء تجليد وتصفيح فوتوغرافي ألماني', 'c1000000-0000-0000-0000-000000000005', 'جردل 5 لتر خالي من الأحماض Acid-Free', 'لتر', 7, 3, 10, 's1000000-0000-0000-0000-000000000002', 70.00, 70.00, 'مخزن المواد الكيميائية', 'لا يصفر مع الوقت', NULL),
('i1000000-0000-0000-0000-000000000020', 'MAT-CELL-THM', 'سلوفان حراري مطفي للصور (Thermal Lamination)', 'c1000000-0000-0000-0000-000000000005', 'رول 32 سم × 200 متر ميكرون 32', 'رزمة', 1, 2, 4, 's1000000-0000-0000-0000-000000000001', 310.00, 310.00, 'بجانب ماكينة السلوفان', 'تحت الحد الأدنى', NULL),
('i1000000-0000-0000-0000-000000000021', 'MAT-TAPE-3M', 'شريط لاصق مزدوج فائق القوة 3M', 'c1000000-0000-0000-0000-000000000005', 'بكرة 50 متر عرض 2 سم', 'قطعة', 8, 4, 15, 's1000000-0000-0000-0000-000000000002', 45.00, 45.00, 'درج اللوازم السريعة', '', NULL),

-- إطارات وبراويز
('i1000000-0000-0000-0000-000000000022', 'FRM-3040-WOD', 'برواز خشب مودرن 30×40 سم (أسود)', 'c1000000-0000-0000-0000-000000000006', 'خشب طبيعي زان مع باسبارتو أبيض وزجاج', 'قطعة', 11, 5, 20, 's1000000-0000-0000-0000-000000000003', 140.00, 140.00, 'مستودع البراويز الجاهزة', '', NULL),
('i1000000-0000-0000-0000-000000000023', 'FRM-2030-ACR', 'إطار أكريليك شفاف مغناطيسي 20×30 سم', 'c1000000-0000-0000-0000-000000000006', 'سمك 10 مم مزدوج وجهين مع قواعد مكتبية', 'قطعة', 4, 4, 10, 's1000000-0000-0000-0000-000000000003', 95.00, 95.00, 'مستودع البراويز الجاهزة', 'تحت الحد الأدنى', NULL)
ON CONFLICT (sku) DO NOTHING;

-- قوالب الشغل (Job Templates)
INSERT INTO public.job_templates (id, name, description) VALUES
('t1000000-0000-0000-0000-000000000001', 'تغليف ألبوم عرائس فاخر 30×40 (20 صفحة)', 'تغليف ألبوم هاردكفر جلد مع طباعة وسلوفان وكبس كرتون'),
('t1000000-0000-0000-0000-000000000002', 'طباعة باقة صور خطوبة (20 صورة 15×21)', 'طباعة وسلوفان لعدد 20 صورة مقاس 15×21 سم مع إطار هدية'),
('t1000000-0000-0000-0000-000000000003', 'طباعة تابلوه كانفاس كبير 40×60 سم مع شد خشب', 'طباعة كانفاس طبيعي مع شد يدوي على شاسيه خشب')
ON CONFLICT DO NOTHING;

-- بنود قوالب الشغل
INSERT INTO public.job_template_lines (template_id, item_id, quantity) VALUES
-- قالب ألبوم عرائس 30×40
('t1000000-0000-0000-0000-000000000001', 'i1000000-0000-0000-0000-000000000014', 1),   -- ألبوم جلد فاخر 1
('t1000000-0000-0000-0000-000000000001', 'i1000000-0000-0000-0000-000000000005', 20),  -- 20 صورة مقاس 30×40
('t1000000-0000-0000-0000-000000000001', 'i1000000-0000-0000-0000-000000000017', 5),   -- 5 ألواح كرتون 2 مم
('t1000000-0000-0000-0000-000000000001', 'i1000000-0000-0000-0000-000000000019', 0.5), -- 0.5 لتر غراء تجليد

-- قالب باقة خطوبة 20 صورة 15×21
('t1000000-0000-0000-0000-000000000002', 'i1000000-0000-0000-0000-000000000003', 20),  -- 20 صورة 15×21
('t1000000-0000-0000-0000-000000000002', 'i1000000-0000-0000-0000-000000000023', 1),   -- إطار أكريليك هدية

-- قالب تابلوه كانفاس 40×60
('t1000000-0000-0000-0000-000000000003', 'i1000000-0000-0000-0000-000000000009', 1),   -- متر قماش كانفاس
('t1000000-0000-0000-0000-000000000003', 'i1000000-0000-0000-0000-000000000021', 1)    -- بكرة شريط لاصق
ON CONFLICT DO NOTHING;

-- حركات تجريبية سابقة لتغذية متوسط الاستهلاك وحساب توقع النفاد
INSERT INTO public.stock_movements (
    item_id, quantity_before, quantity_after, change_amount, type, reason, created_by, created_at
) VALUES
('i1000000-0000-0000-0000-000000000005', 28, 8, -20, 'consume', 'صرف صور لألبوم حفل زفاف', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '12 days'),
('i1000000-0000-0000-0000-000000000006', 7, 3, -4, 'consume', 'صرف بوسترات معرض', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '8 days'),
('i1000000-0000-0000-0000-000000000007', 5, 2, -3, 'consume', 'استهلاك رولات ورق لامع', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '15 days'),
('i1000000-0000-0000-0000-000000000011', 3, 1, -2, 'consume', 'استهلاك حبر أزرق في طباعة ألبومات', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '6 days'),
('i1000000-0000-0000-0000-000000000012', 2, 0, -2, 'consume', 'نفاد الحبر الأحمر في جلسات تصوير العيد', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '3 days'),
('i1000000-0000-0000-0000-000000000001', 550, 450, -100, 'consume', 'طباعة وتوزيع صور تخرج مدرسة', 'editor', timezone('Africa/Cairo', now()) - INTERVAL '5 days')
ON CONFLICT DO NOTHING;
