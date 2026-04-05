-- ============================================================
-- HEL BAZA — Полная схема базы данных
-- Supabase (PostgreSQL 17)
-- ============================================================

-- Расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- нечёткий поиск по OEM
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- нормализация текста

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE oem_type AS ENUM ('original', 'analog');
CREATE TYPE oem_status AS ENUM ('active', 'new_oem', 'deprecated');
CREATE TYPE scheme_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE match_type AS ENUM ('exact', 'compatible', 'similar');
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'dealer', 'client');
CREATE TYPE order_status AS ENUM ('draft', 'pending', 'sent_to_1c', 'confirmed', 'shipped', 'completed', 'cancelled');
CREATE TYPE transaction_type AS ENUM ('topup', 'query_charge', 'refund', 'adjustment');
CREATE TYPE search_query_type AS ENUM ('oem', 'vin', 'brand_model', 'analog', 'text');
CREATE TYPE vehicle_type AS ENUM ('auto', 'moto');
CREATE TYPE fitting_position AS ENUM ('left', 'right');
CREATE TYPE hose_position AS ENUM ('front_left', 'front_right', 'rear_left', 'rear_right', 'clutch', 'other');
CREATE TYPE image_type AS ENUM ('photo', 'diagram', 'drawing');
CREATE TYPE component_type AS ENUM ('hose', 'support', 'heatshrink', 'accessory');
CREATE TYPE thread_type AS ENUM ('metric', 'imperial', 'bsp', 'npt');

-- ============================================================
-- 1. MANUFACTURERS (Производители)
-- ============================================================

CREATE TABLE manufacturers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE,
    is_approved BOOLEAN NOT NULL DEFAULT false,
    is_original BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE manufacturers IS 'Производители OEM: ATE, Bosch, Dorman, TRW, Masumo, HEL и др.';

-- Предзаполнение одобренных производителей
INSERT INTO manufacturers (name, code, is_approved, is_original) VALUES
    ('HEL Performance', 'HEL', true, false),
    ('ATE', 'ATE', true, false),
    ('Bosch', 'BOSCH', true, false),
    ('Dorman', 'DORMAN', true, false),
    ('TRW', 'TRW', true, false),
    ('Masumo', 'MASUMO', true, false);

-- ============================================================
-- 2. SCHEMES (Схемы / ИД)
-- ============================================================

CREATE TABLE schemes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_number VARCHAR(50) NOT NULL UNIQUE,
    sku VARCHAR(50) UNIQUE,
    description TEXT,
    status scheme_status NOT NULL DEFAULT 'draft',
    is_public BOOLEAN NOT NULL DEFAULT false,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE schemes IS 'Схемы (ИД) — центральная сущность. Инструкция по сборке шланга.';

CREATE INDEX idx_schemes_status ON schemes(status);
CREATE INDEX idx_schemes_sku ON schemes(sku) WHERE sku IS NOT NULL;
CREATE INDEX idx_schemes_public ON schemes(is_public) WHERE is_public = true;

-- Автогенерация scheme_number
CREATE SEQUENCE scheme_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_scheme_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.scheme_number IS NULL OR NEW.scheme_number = '' THEN
        NEW.scheme_number := 'HEL-' || LPAD(nextval('scheme_number_seq')::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scheme_number
    BEFORE INSERT ON schemes
    FOR EACH ROW
    EXECUTE FUNCTION generate_scheme_number();

-- ============================================================
-- 3. SCHEME IMAGES
-- ============================================================

CREATE TABLE scheme_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    type image_type NOT NULL DEFAULT 'photo',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    has_watermark BOOLEAN NOT NULL DEFAULT false,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheme_images_scheme ON scheme_images(scheme_id);

-- ============================================================
-- 4. OEM NUMBERS
-- ============================================================

CREATE TABLE oem_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oem_number VARCHAR(100) NOT NULL,
    oem_number_normalized VARCHAR(100) NOT NULL, -- без пробелов, дефисов, upper
    oem_type oem_type NOT NULL DEFAULT 'original',
    manufacturer_id UUID REFERENCES manufacturers(id),
    status oem_status NOT NULL DEFAULT 'active',
    raw_data JSONB DEFAULT '{}',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(oem_number, manufacturer_id)
);

COMMENT ON TABLE oem_numbers IS 'OEM номера: оригинальные и аналоги. Связь через oem_cross_references.';

-- Нормализация OEM: убираем пробелы, дефисы, приводим к верхнему регистру
CREATE OR REPLACE FUNCTION normalize_oem_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.oem_number_normalized := UPPER(REGEXP_REPLACE(NEW.oem_number, '[^A-Za-z0-9]', '', 'g'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_oem
    BEFORE INSERT OR UPDATE ON oem_numbers
    FOR EACH ROW
    EXECUTE FUNCTION normalize_oem_number();

-- Индексы для поиска
CREATE INDEX idx_oem_normalized ON oem_numbers(oem_number_normalized);
CREATE INDEX idx_oem_trgm ON oem_numbers USING gin(oem_number_normalized gin_trgm_ops);
CREATE INDEX idx_oem_type ON oem_numbers(oem_type);
CREATE INDEX idx_oem_status ON oem_numbers(status);
CREATE INDEX idx_oem_manufacturer ON oem_numbers(manufacturer_id);

-- ============================================================
-- 5. OEM ↔ SCHEME LINKS
-- ============================================================

CREATE TABLE oem_scheme_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oem_id UUID NOT NULL REFERENCES oem_numbers(id) ON DELETE CASCADE,
    scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    link_type VARCHAR(20) NOT NULL DEFAULT 'primary',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(oem_id, scheme_id)
);

CREATE INDEX idx_oem_scheme_oem ON oem_scheme_links(oem_id);
CREATE INDEX idx_oem_scheme_scheme ON oem_scheme_links(scheme_id);

-- ============================================================
-- 6. OEM CROSS REFERENCES (Кроссы аналогов)
-- ============================================================

CREATE TABLE oem_cross_references (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_oem_id UUID NOT NULL REFERENCES oem_numbers(id) ON DELETE CASCADE,
    target_oem_id UUID NOT NULL REFERENCES oem_numbers(id) ON DELETE CASCADE,
    match_type match_type NOT NULL DEFAULT 'exact',
    confidence_score FLOAT DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source_oem_id, target_oem_id),
    CHECK (source_oem_id != target_oem_id)
);

CREATE INDEX idx_cross_source ON oem_cross_references(source_oem_id);
CREATE INDEX idx_cross_target ON oem_cross_references(target_oem_id);

-- ============================================================
-- 7. VEHICLES (Применимость)
-- ============================================================

CREATE TABLE vehicle_brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type vehicle_type NOT NULL DEFAULT 'auto',
    UNIQUE(name, type)
);

CREATE TABLE vehicle_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    generation VARCHAR(50),
    UNIQUE(brand_id, name, generation)
);

CREATE INDEX idx_models_brand ON vehicle_models(brand_id);

CREATE TABLE vehicle_modifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
    year_from INT,
    year_to INT,
    engine VARCHAR(100),
    body_type VARCHAR(50),
    attributes JSONB DEFAULT '{}',
    CHECK (year_to IS NULL OR year_to >= year_from)
);

CREATE INDEX idx_modifications_model ON vehicle_modifications(model_id);
CREATE INDEX idx_modifications_years ON vehicle_modifications(year_from, year_to);

CREATE TABLE applicability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oem_id UUID NOT NULL REFERENCES oem_numbers(id) ON DELETE CASCADE,
    modification_id UUID NOT NULL REFERENCES vehicle_modifications(id) ON DELETE CASCADE,
    position hose_position DEFAULT 'other',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(oem_id, modification_id, position)
);

CREATE INDEX idx_applicability_oem ON applicability(oem_id);
CREATE INDEX idx_applicability_mod ON applicability(modification_id);

-- ============================================================
-- 8. FITTINGS (Фитинги и комплектующие)
-- ============================================================

CREATE TABLE fitting_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO fitting_categories (name, code, sort_order) VALUES
    ('Banjo', 'banjo', 1),
    ('Swivel Male', 'swivel_male', 2),
    ('Fixed Male', 'fixed_male', 3),
    ('Fixed Extended Male', 'fixed_extended_male', 4),
    ('Fixed Bulkhead Male', 'fixed_bulkhead_male', 5),
    ('Fixed Bulkhead Male with Bleed Nipple', 'fixed_bulkhead_bleed', 6),
    ('Fixed NPT Male', 'fixed_npt_male', 7),
    ('Swivel Female', 'swivel_female', 8),
    ('Swivel Female with NPT Male', 'swivel_female_npt', 9),
    ('Swivel Female Extended Barrel', 'swivel_female_ext', 10),
    ('Swivel Circlip Female', 'swivel_circlip_female', 11),
    ('Swivel Circlip Female (Notched)', 'swivel_circlip_notched', 12),
    ('Swivel Circlip Female (Flat Face)', 'swivel_circlip_flat', 13),
    ('Fixed Circlip Female (Notched)', 'fixed_circlip_notched', 14),
    ('Swivel Circlip Female Extended Barrel', 'swivel_circlip_ext', 15);

CREATE TABLE fittings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES fitting_categories(id),
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    size VARCHAR(50), -- M10x1.0, M10x1.25, 3/8-24, etc.
    thread_type thread_type,
    dimensions JSONB DEFAULT '{}',
    image_url VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fittings_category ON fittings(category_id);
CREATE INDEX idx_fittings_sku ON fittings(sku);
CREATE INDEX idx_fittings_active ON fittings(is_active) WHERE is_active = true;

-- ============================================================
-- 9. FITTING ANGLES
-- ============================================================

CREATE TABLE fitting_angles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,
    degrees INT NOT NULL,
    image_url VARCHAR(500),
    sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO fitting_angles (name, degrees, sort_order) VALUES
    ('Straight', 0, 1),
    ('20°', 20, 2),
    ('30°', 30, 3),
    ('45°', 45, 4),
    ('60°', 60, 5),
    ('90°', 90, 6);

-- ============================================================
-- 10. HOSE COLORS
-- ============================================================

CREATE TABLE hose_colors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,
    hex_code VARCHAR(7),
    image_url VARCHAR(500),
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO hose_colors (name, hex_code, sort_order) VALUES
    ('Clear', '#CCCCCC', 1),
    ('Black', '#000000', 2),
    ('Blue', '#0066CC', 3),
    ('Red', '#CC0000', 4),
    ('Green', '#006600', 5),
    ('Yellow', '#CCCC00', 6),
    ('Orange', '#CC6600', 7),
    ('Purple', '#660099', 8),
    ('Carbon', '#333333', 9);

-- ============================================================
-- 11. PRICE TYPES
-- ============================================================

CREATE TABLE price_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    coefficient DECIMAL(5,3) NOT NULL DEFAULT 1.000,
    currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO price_types (name, display_name, coefficient, currency) VALUES
    ('retail', 'Розница', 1.000, 'RUB'),
    ('wholesale', 'Опт', 0.700, 'RUB'),
    ('dealer', 'Дилер', 0.800, 'RUB'),
    ('marketplace_ozon', 'Ozon', 1.150, 'RUB'),
    ('marketplace_wb', 'Wildberries', 1.120, 'RUB'),
    ('export_gbp', 'Экспорт GBP', 1.000, 'GBP'),
    ('crm', 'CRM Bitrix', 1.000, 'RUB');

-- ============================================================
-- 12. FITTING PRICES
-- ============================================================

CREATE TABLE fitting_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fitting_id UUID NOT NULL REFERENCES fittings(id) ON DELETE CASCADE,
    price_type_id UUID NOT NULL REFERENCES price_types(id),
    price DECIMAL(12,2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to TIMESTAMPTZ,
    source VARCHAR(50) DEFAULT 'manual', -- manual | 1c_import
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(fitting_id, price_type_id, valid_from)
);

CREATE INDEX idx_fitting_prices_fitting ON fitting_prices(fitting_id);
CREATE INDEX idx_fitting_prices_type ON fitting_prices(price_type_id);
CREATE INDEX idx_fitting_prices_valid ON fitting_prices(valid_from, valid_to);

-- ============================================================
-- 13. SCHEME COMPOSITION (Состав схемы)
-- ============================================================

CREATE TABLE scheme_fittings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    fitting_id UUID NOT NULL REFERENCES fittings(id),
    position fitting_position NOT NULL,
    angle_id UUID REFERENCES fitting_angles(id),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheme_fittings_scheme ON scheme_fittings(scheme_id);

CREATE TABLE scheme_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    component_type component_type NOT NULL,
    color_id UUID REFERENCES hose_colors(id),
    length_cm INT,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheme_components_scheme ON scheme_components(scheme_id);

-- ============================================================
-- 14. SCHEME PRICES (Рассчитанные цены схем)
-- ============================================================

CREATE TABLE scheme_prices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
    price_type_id UUID NOT NULL REFERENCES price_types(id),
    calculated_price DECIMAL(12,2),
    manual_override DECIMAL(12,2),
    currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(scheme_id, price_type_id)
);

CREATE INDEX idx_scheme_prices_scheme ON scheme_prices(scheme_id);

-- ============================================================
-- 15. PROFILES (Пользователи)
-- ============================================================

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'client',
    email VARCHAR(255),
    full_name VARCHAR(200),
    company_name VARCHAR(200),
    phone VARCHAR(50),
    inn VARCHAR(20),
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON profiles(role);

-- Автоматическое создание профиля при регистрации
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'client');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 16. BALANCE TRANSACTIONS (Баланс дилера)
-- ============================================================

CREATE TABLE balance_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    type transaction_type NOT NULL,
    balance_after DECIMAL(12,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_tx_profile ON balance_transactions(profile_id);
CREATE INDEX idx_balance_tx_created ON balance_transactions(created_at);

-- ============================================================
-- 17. SEARCH LOGS (Логирование)
-- ============================================================

CREATE TABLE search_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id),
    query_type search_query_type NOT NULL,
    query_text VARCHAR(500) NOT NULL,
    results_count INT NOT NULL DEFAULT 0,
    charge_amount DECIMAL(12,2) DEFAULT 0,
    ip_address INET,
    user_agent TEXT,
    response_time_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_logs_user ON search_logs(user_id);
CREATE INDEX idx_search_logs_created ON search_logs(created_at);
CREATE INDEX idx_search_logs_type ON search_logs(query_type);
CREATE INDEX idx_search_logs_query ON search_logs USING gin(query_text gin_trgm_ops);

-- ============================================================
-- 18. ORDERS (Заказы)
-- ============================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id),
    scheme_id UUID REFERENCES schemes(id),
    status order_status NOT NULL DEFAULT 'draft',
    total_price DECIMAL(12,2),
    currency VARCHAR(3) NOT NULL DEFAULT 'RUB',
    configuration JSONB DEFAULT '{}', -- полная конфигурация конструктора
    external_order_id VARCHAR(100), -- ID в 1С
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_profile ON orders(profile_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    fitting_id UUID REFERENCES fittings(id),
    description VARCHAR(200),
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ============================================================
-- 19. EXPORT CHANNELS (Каналы выгрузки)
-- ============================================================

CREATE TABLE export_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    field_mapping JSONB DEFAULT '{}',
    price_type_id UUID REFERENCES price_types(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO export_channels (name, display_name) VALUES
    ('site', 'Сайт-витрина'),
    ('ozon', 'Ozon'),
    ('wildberries', 'Wildberries'),
    ('emex', 'Emex'),
    ('zzap', 'ZZAP'),
    ('crm_bitrix', 'Bitrix24 CRM');

CREATE TABLE export_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id UUID REFERENCES export_channels(id),
    name VARCHAR(100) NOT NULL,
    columns JSONB NOT NULL DEFAULT '[]',
    filters JSONB DEFAULT '{}',
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 20. UPDATED_AT TRIGGER (автообновление)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Применяем ко всем таблицам с updated_at
CREATE TRIGGER trg_updated_at_schemes BEFORE UPDATE ON schemes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_updated_at_oem BEFORE UPDATE ON oem_numbers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_updated_at_manufacturers BEFORE UPDATE ON manufacturers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_updated_at_fittings BEFORE UPDATE ON fittings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_updated_at_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_updated_at_orders BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 21. MATERIALIZED VIEW — Плоская карточка для поиска
-- ============================================================

CREATE MATERIALIZED VIEW mv_scheme_cards AS
SELECT
    s.id AS scheme_id,
    s.scheme_number,
    s.sku,
    s.description,
    s.status,
    s.is_public,
    s.is_verified,
    -- OEM номера (массив)
    ARRAY_AGG(DISTINCT o.oem_number) FILTER (WHERE o.id IS NOT NULL) AS oem_numbers,
    ARRAY_AGG(DISTINCT o.oem_number_normalized) FILTER (WHERE o.id IS NOT NULL) AS oem_normalized,
    -- Производители
    ARRAY_AGG(DISTINCT m.name) FILTER (WHERE m.id IS NOT NULL) AS manufacturers,
    -- Первое изображение
    (SELECT url FROM scheme_images si WHERE si.scheme_id = s.id AND si.is_primary = true LIMIT 1) AS primary_image,
    -- Применимость (JSON массив)
    JSONB_AGG(DISTINCT jsonb_build_object(
        'brand', vb.name,
        'model', vm.name,
        'year_from', vmod.year_from,
        'year_to', vmod.year_to
    )) FILTER (WHERE vb.id IS NOT NULL) AS applicability,
    s.created_at,
    s.updated_at
FROM schemes s
LEFT JOIN oem_scheme_links osl ON osl.scheme_id = s.id
LEFT JOIN oem_numbers o ON o.id = osl.oem_id
LEFT JOIN manufacturers m ON m.id = o.manufacturer_id
LEFT JOIN applicability app ON app.oem_id = o.id
LEFT JOIN vehicle_modifications vmod ON vmod.id = app.modification_id
LEFT JOIN vehicle_models vm ON vm.id = vmod.model_id
LEFT JOIN vehicle_brands vb ON vb.id = vm.brand_id
GROUP BY s.id;

CREATE UNIQUE INDEX idx_mv_scheme_cards_id ON mv_scheme_cards(scheme_id);
CREATE INDEX idx_mv_scheme_cards_oem ON mv_scheme_cards USING gin(oem_normalized);

-- Функция обновления materialized view
CREATE OR REPLACE FUNCTION refresh_scheme_cards()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_scheme_cards;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 22. SEARCH FUNCTION (Поиск по OEM)
-- ============================================================

CREATE OR REPLACE FUNCTION search_by_oem(search_term TEXT)
RETURNS TABLE (
    scheme_id UUID,
    scheme_number VARCHAR,
    sku VARCHAR,
    oem_number VARCHAR,
    oem_type oem_type,
    manufacturer VARCHAR,
    match_score FLOAT
) AS $$
DECLARE
    normalized TEXT;
BEGIN
    normalized := UPPER(REGEXP_REPLACE(search_term, '[^A-Za-z0-9]', '', 'g'));

    RETURN QUERY
    SELECT
        s.id,
        s.scheme_number,
        s.sku,
        o.oem_number,
        o.oem_type,
        m.name,
        similarity(o.oem_number_normalized, normalized)::FLOAT AS match_score
    FROM oem_numbers o
    JOIN oem_scheme_links osl ON osl.oem_id = o.id
    JOIN schemes s ON s.id = osl.scheme_id
    LEFT JOIN manufacturers m ON m.id = o.manufacturer_id
    WHERE o.oem_number_normalized % normalized
       OR o.oem_number_normalized LIKE normalized || '%'
    ORDER BY
        CASE WHEN o.oem_number_normalized = normalized THEN 0 ELSE 1 END,
        similarity(o.oem_number_normalized, normalized) DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 23. PRICE CALCULATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_scheme_price(
    p_scheme_id UUID,
    p_price_type VARCHAR DEFAULT 'retail'
)
RETURNS DECIMAL AS $$
DECLARE
    total DECIMAL := 0;
    coeff DECIMAL := 1;
BEGIN
    -- Получаем коэффициент типа цены
    SELECT coefficient INTO coeff FROM price_types WHERE name = p_price_type AND is_active = true;
    IF coeff IS NULL THEN coeff := 1; END IF;

    -- Сумма цен фитингов
    SELECT COALESCE(SUM(fp.price * sf.quantity), 0) INTO total
    FROM scheme_fittings sf
    JOIN fitting_prices fp ON fp.fitting_id = sf.fitting_id
    JOIN price_types pt ON pt.id = fp.price_type_id AND pt.name = 'retail'
    WHERE sf.scheme_id = p_scheme_id
      AND (fp.valid_to IS NULL OR fp.valid_to > now());

    -- Применяем коэффициент
    total := total * coeff;

    RETURN ROUND(total, 2);
END;
$$ LANGUAGE plpgsql;
