-- ============================================================
-- DbAnalyser Test Database (PostgreSQL)
-- Port of setup.sql for SQL Server
-- Demonstrates: tables, FKs, views, functions, triggers,
--               implicit relationships, cross-schema references
-- ============================================================

-- ============================================================
-- SCHEMAS
-- ============================================================

-- public schema exists by default (equivalent to dbo)
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS external;

-- ============================================================
-- "External" tables (replaces cross-DB references)
-- ============================================================

CREATE TABLE external.external_audit_log (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    object_type VARCHAR(50) NOT NULL,
    object_id INT NOT NULL,
    changed_by VARCHAR(100) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE external.external_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLES - Core (no outbound FKs)
-- ============================================================

CREATE TABLE public.countries (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code CHAR(2) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE public.categories (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL
);

CREATE TABLE public.roles (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
);

-- ============================================================
-- TABLES - Second level
-- ============================================================

CREATE TABLE public.customers (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(200) NOT NULL UNIQUE,
    country_id INT NOT NULL CONSTRAINT fk_customers_countries REFERENCES public.countries(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.users (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(200) NOT NULL,
    role_id INT NOT NULL CONSTRAINT fk_users_roles REFERENCES public.roles(id),
    customer_id INT NULL CONSTRAINT fk_users_customers REFERENCES public.customers(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.products (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    sku VARCHAR(50) NOT NULL UNIQUE,
    price NUMERIC(18,2) NOT NULL,
    category_id INT NOT NULL CONSTRAINT fk_products_categories REFERENCES public.categories(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.suppliers (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_name VARCHAR(200) NOT NULL,
    contact_email VARCHAR(200) NULL,
    country_id INT NOT NULL CONSTRAINT fk_suppliers_countries REFERENCES public.countries(id)
);

-- ============================================================
-- TABLES - Third level
-- ============================================================

CREATE TABLE public.product_suppliers (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INT NOT NULL CONSTRAINT fk_productsuppliers_products REFERENCES public.products(id),
    supplier_id INT NOT NULL CONSTRAINT fk_productsuppliers_suppliers REFERENCES public.suppliers(id),
    cost_price NUMERIC(18,2) NOT NULL,
    lead_time_days INT NULL,
    CONSTRAINT uq_productsupplier UNIQUE (product_id, supplier_id)
);

CREATE TABLE public.orders (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INT NOT NULL CONSTRAINT fk_orders_customers REFERENCES public.customers(id),
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    shipping_country_id INT NULL CONSTRAINT fk_orders_countries REFERENCES public.countries(id)
);

CREATE TABLE public.order_items (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT NOT NULL CONSTRAINT fk_orderitems_orders REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id INT NOT NULL CONSTRAINT fk_orderitems_products REFERENCES public.products(id),
    quantity INT NOT NULL,
    unit_price NUMERIC(18,2) NOT NULL,
    discount NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.payments (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT NOT NULL CONSTRAINT fk_payments_orders REFERENCES public.orders(id),
    amount NUMERIC(18,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    paid_at TIMESTAMPTZ NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending'
);

CREATE TABLE public.reviews (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INT NOT NULL CONSTRAINT fk_reviews_products REFERENCES public.products(id),
    customer_id INT NOT NULL CONSTRAINT fk_reviews_customers REFERENCES public.customers(id),
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(1000) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standalone tables (orphans, no FKs)
CREATE TABLE public.app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Implicit FK relationships (no constraint, but naming convention matches)
CREATE TABLE public.shipping_addresses (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id INT NOT NULL,
    street VARCHAR(200) NOT NULL,
    city VARCHAR(100) NOT NULL,
    zip_code VARCHAR(20) NOT NULL,
    country_id INT NOT NULL
);

CREATE TABLE public.error_log (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message TEXT NOT NULL,
    stack_trace TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Second schema tables
-- ============================================================

CREATE TABLE inventory.warehouses (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    country_id INT NOT NULL CONSTRAINT fk_warehouses_countries REFERENCES public.countries(id)
);

CREATE TABLE inventory.stock (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    warehouse_id INT NOT NULL CONSTRAINT fk_stock_warehouses REFERENCES inventory.warehouses(id),
    product_id INT NOT NULL CONSTRAINT fk_stock_products REFERENCES public.products(id),
    quantity INT NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_warehouseproduct UNIQUE (warehouse_id, product_id)
);

-- ============================================================
-- TABLES for implicit FK pattern testing (Patterns 4-7)
-- ============================================================

-- Table with Pattern 4 test: {TableName}ID (all-caps ID variant)
CREATE TABLE public.invoices (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    orderid INT NOT NULL,              -- Pattern 4: "OrderID" -> Orders
    amount NUMERIC(18,2) NOT NULL,
    invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table with Pattern 5 test: prefix stripping (Source/Ref/Parent etc.)
CREATE TABLE public.transfers (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_customer_id INT NOT NULL,   -- Pattern 5: strip "Source" -> Customer -> Customers
    target_customer_id INT NOT NULL,   -- Pattern 5: strip "Target" -> Customer -> Customers
    ref_product_id INT NOT NULL,       -- Pattern 5: strip "Ref" -> Product -> Products
    amount NUMERIC(18,2) NOT NULL,
    transfer_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table with Pattern 6 test: {TableName}Key / {TableName}_Key
CREATE TABLE public.audit_entries (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_key INT NOT NULL,         -- Pattern 6: "CustomerKey" -> Customers
    product_key INT NOT NULL,          -- Pattern 6: "Product_Key" -> Products
    action VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table with Pattern 7 test: {TableName}No / {TableName}Number / {TableName}Code
CREATE TABLE public.shipments (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no INT NOT NULL,             -- Pattern 7: "OrderNo" -> Orders
    customer_number INT NOT NULL,      -- Pattern 7: "CustomerNumber" -> Customers
    country_code INT NOT NULL,         -- Pattern 7: "CountryCode" -> Countries (type mismatch!)
    shipped_at TIMESTAMPTZ NULL
);

-- Table with type mismatch test (should NOT generate implicit FK)
CREATE TABLE public.mismatch_test (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL,  -- Type mismatch: varchar vs int -> should be skipped
    order_id BIGINT NOT NULL           -- Type compatible: bigint vs int -> should match with reduced confidence
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX ix_customers_countryid ON public.customers(country_id);
CREATE INDEX ix_customers_email ON public.customers(email);
CREATE INDEX ix_products_categoryid ON public.products(category_id);
CREATE INDEX ix_orders_customerid ON public.orders(customer_id);
CREATE INDEX ix_orders_status ON public.orders(status);
CREATE INDEX ix_orderitems_orderid ON public.order_items(order_id);
CREATE INDEX ix_orderitems_productid ON public.order_items(product_id);
CREATE INDEX ix_stock_productid ON inventory.stock(product_id);
CREATE INDEX ix_shipments_orderno ON public.shipments(order_no);

-- ============================================================
-- VIEWS
-- ============================================================

CREATE VIEW public.vw_customer_orders AS
SELECT
    c.id AS customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    c.email,
    o.id AS order_id,
    o.order_date,
    o.status,
    o.total_amount
FROM public.customers c
JOIN public.orders o ON o.customer_id = c.id;

CREATE VIEW public.vw_product_catalog AS
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.price,
    cat.name AS category_name,
    COALESCE(AVG(r.rating::FLOAT), 0) AS avg_rating,
    COUNT(r.id) AS review_count
FROM public.products p
JOIN public.categories cat ON cat.id = p.category_id
LEFT JOIN public.reviews r ON r.product_id = p.id
WHERE p.is_active = TRUE
GROUP BY p.id, p.name, p.sku, p.price, cat.name;

-- View that depends on another view
CREATE VIEW public.vw_order_details AS
SELECT
    o.id AS order_id,
    co.customer_name,
    o.order_date,
    o.status,
    oi.product_id,
    p.name AS product_name,
    oi.quantity,
    oi.unit_price,
    oi.discount,
    (oi.quantity * oi.unit_price * (1 - oi.discount / 100)) AS line_total
FROM public.orders o
JOIN public.vw_customer_orders co ON co.order_id = o.id
JOIN public.order_items oi ON oi.order_id = o.id
JOIN public.products p ON p.id = oi.product_id;

CREATE VIEW inventory.vw_stock_overview AS
SELECT
    w.name AS warehouse_name,
    p.name AS product_name,
    p.sku,
    s.quantity,
    s.last_updated,
    cn.name AS country
FROM inventory.stock s
JOIN inventory.warehouses w ON w.id = s.warehouse_id
JOIN public.products p ON p.id = s.product_id
JOIN public.countries cn ON cn.id = w.country_id;

-- View that references a function (created after function below)
-- See: vw_customer_spending

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Scalar function
CREATE FUNCTION public.fn_get_customer_total_spend(p_customer_id INT)
RETURNS NUMERIC(18,2)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total NUMERIC(18,2);
BEGIN
    SELECT COALESCE(SUM(total_amount), 0) INTO v_total
    FROM public.orders
    WHERE customer_id = p_customer_id AND status != 'Cancelled';
    RETURN v_total;
END;
$$;

-- Table-returning function (equivalent to inline TVF)
CREATE FUNCTION public.fn_get_products_by_category(p_category_id INT)
RETURNS TABLE (
    id INT,
    name VARCHAR(200),
    sku VARCHAR(50),
    price NUMERIC(18,2),
    category_name VARCHAR(100)
)
LANGUAGE sql
AS $$
    SELECT p.id, p.name, p.sku, p.price, cat.name AS category_name
    FROM public.products p
    JOIN public.categories cat ON cat.id = p.category_id
    WHERE p.category_id = p_category_id AND p.is_active = TRUE;
$$;

-- Table-returning function (equivalent to multi-statement TVF)
CREATE FUNCTION public.fn_get_customer_order_history(p_customer_id INT)
RETURNS TABLE (
    order_id INT,
    order_date TIMESTAMPTZ,
    status VARCHAR(20),
    total_amount NUMERIC(18,2),
    item_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.order_date,
        o.status,
        o.total_amount,
        COUNT(oi.id)
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = p_customer_id
    GROUP BY o.id, o.order_date, o.status, o.total_amount;
END;
$$;

-- Function that references a view
CREATE FUNCTION inventory.fn_get_low_stock(p_threshold INT)
RETURNS TABLE (
    warehouse_name VARCHAR(100),
    product_name VARCHAR(200),
    sku VARCHAR(50),
    quantity INT,
    country VARCHAR(100)
)
LANGUAGE sql
AS $$
    SELECT warehouse_name, product_name, sku, quantity, country
    FROM inventory.vw_stock_overview
    WHERE quantity < p_threshold;
$$;

-- Function that calls another function
CREATE FUNCTION public.fn_get_customer_summary(p_customer_id INT)
RETURNS VARCHAR(500)
LANGUAGE plpgsql
AS $$
DECLARE
    v_total NUMERIC(18,2);
    v_name VARCHAR(200);
BEGIN
    v_total := public.fn_get_customer_total_spend(p_customer_id);

    SELECT first_name || ' ' || last_name INTO v_name
    FROM public.customers WHERE id = p_customer_id;

    RETURN v_name || ': ' || v_total::VARCHAR(20);
END;
$$;

-- Function that references a view and another function
CREATE FUNCTION public.fn_get_top_customer()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_top_id INT;
BEGIN
    SELECT customer_id INTO v_top_id
    FROM public.vw_customer_orders
    GROUP BY customer_id
    ORDER BY SUM(total_amount) DESC
    LIMIT 1;
    RETURN v_top_id;
END;
$$;

-- Function that references external schema (replaces cross-DB fn_GetConfigValue)
CREATE FUNCTION public.fn_get_config_value(p_key VARCHAR(100))
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_val TEXT;
BEGIN
    SELECT config_value INTO v_val
    FROM external.external_config
    WHERE config_key = p_key;
    RETURN v_val;
END;
$$;

-- ============================================================
-- View that references a function (must be created after function)
-- ============================================================

CREATE VIEW public.vw_customer_spending AS
SELECT
    c.id AS customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    public.fn_get_customer_total_spend(c.id) AS total_spend,
    COUNT(o.id) AS order_count
FROM public.customers c
LEFT JOIN public.orders o ON o.customer_id = c.id
GROUP BY c.id, c.first_name, c.last_name;

-- ============================================================
-- STORED PROCEDURES (as functions returning void / SETOF)
-- ============================================================

-- Equivalent to usp_CreateOrder
CREATE FUNCTION public.usp_create_order(
    p_customer_id INT,
    p_shipping_country_id INT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_id INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND is_active = TRUE) THEN
        RAISE EXCEPTION 'Customer not found or inactive';
    END IF;
    INSERT INTO public.orders (customer_id, shipping_country_id)
    VALUES (p_customer_id, p_shipping_country_id)
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
END;
$$;

-- Equivalent to usp_AddOrderItem
CREATE FUNCTION public.usp_add_order_item(
    p_order_id INT,
    p_product_id INT,
    p_quantity INT,
    p_discount NUMERIC(5,2) DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_price NUMERIC(18,2);
BEGIN
    SELECT price INTO v_price FROM public.products WHERE id = p_product_id AND is_active = TRUE;
    IF v_price IS NULL THEN
        RAISE EXCEPTION 'Product not found or inactive';
    END IF;
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, discount)
    VALUES (p_order_id, p_product_id, p_quantity, v_price, p_discount);
    UPDATE public.orders
    SET total_amount = (
        SELECT SUM(quantity * unit_price * (1 - discount / 100))
        FROM public.order_items WHERE order_id = p_order_id
    )
    WHERE id = p_order_id;
END;
$$;

-- Equivalent to usp_GetCustomerDashboard
CREATE FUNCTION public.usp_get_customer_dashboard(p_customer_id INT)
RETURNS TABLE (
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(200),
    total_spend NUMERIC(18,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT c.first_name, c.last_name, c.email,
           public.fn_get_customer_total_spend(p_customer_id)
    FROM public.customers c WHERE c.id = p_customer_id;
END;
$$;

-- Equivalent to usp_RecalculateOrderTotal
CREATE FUNCTION public.usp_recalculate_order_total(p_order_id INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.orders
    SET total_amount = (
        SELECT COALESCE(SUM(quantity * unit_price * (1 - discount / 100)), 0)
        FROM public.order_items WHERE order_id = p_order_id
    )
    WHERE id = p_order_id;
END;
$$;

-- Equivalent to usp_CompleteOrder (calls another function)
CREATE FUNCTION public.usp_complete_order(p_order_id INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_total NUMERIC(18,2);
    v_customer_id INT;
BEGIN
    -- Call another function
    PERFORM public.usp_recalculate_order_total(p_order_id);

    UPDATE public.orders SET status = 'Completed' WHERE id = p_order_id;

    -- Also calls a function
    SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = p_order_id;
    v_total := public.fn_get_customer_total_spend(v_customer_id);
END;
$$;

-- Equivalent to inventory.usp_UpdateStock
CREATE FUNCTION inventory.usp_update_stock(
    p_warehouse_id INT,
    p_product_id INT,
    p_quantity_change INT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventory.stock WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id) THEN
        UPDATE inventory.stock
        SET quantity = quantity + p_quantity_change, last_updated = NOW()
        WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id;
    ELSE
        INSERT INTO inventory.stock (warehouse_id, product_id, quantity)
        VALUES (p_warehouse_id, p_product_id, p_quantity_change);
    END IF;
END;
$$;

-- Equivalent to usp_LogAuditAction (cross-schema reference)
CREATE FUNCTION public.usp_log_audit_action(
    p_action VARCHAR(100),
    p_object_type VARCHAR(50),
    p_object_id INT,
    p_changed_by VARCHAR(100)
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO external.external_audit_log (action, object_type, object_id, changed_by)
    VALUES (p_action, p_object_type, p_object_id, p_changed_by);
END;
$$;

-- Equivalent to usp_GetExternalConfig (cross-schema reference)
CREATE FUNCTION public.usp_get_external_config(p_config_key VARCHAR(100))
RETURNS TABLE (
    config_key VARCHAR(100),
    config_value TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT config_key, config_value, updated_at
    FROM external.external_config
    WHERE config_key = p_config_key;
$$;

-- Equivalent to usp_DynamicSearch (uses dynamic SQL)
CREATE FUNCTION public.usp_dynamic_search(
    p_table_name VARCHAR(100),
    p_search_term VARCHAR(200)
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Dynamic SQL: references to tables inside string literals
    EXECUTE format('SELECT * FROM public.products WHERE name LIKE %L', '%' || p_search_term || '%');
    EXECUTE format('SELECT * FROM public.categories WHERE name LIKE %L', '%' || p_search_term || '%');
END;
$$;

-- Equivalent to usp_DynamicReport (uses dynamic SQL)
CREATE FUNCTION public.usp_dynamic_report(
    p_customer_id INT,
    p_include_inactive BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    -- Dynamic SQL with FROM/JOIN inside string literal
    v_sql := 'SELECT c.first_name, c.last_name, o.id AS order_id, o.total_amount
              FROM public.customers c
              JOIN public.orders o ON o.customer_id = c.id
              WHERE c.id = $1';

    IF NOT p_include_inactive THEN
        v_sql := v_sql || ' AND o.status != ''Cancelled''';
    END IF;

    EXECUTE v_sql USING p_customer_id;

    -- Dynamic SQL calling another function
    PERFORM public.usp_recalculate_order_total(1);
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Trigger function: log new orders
CREATE FUNCTION public.trg_orders_after_insert_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.error_log (message, occurred_at)
    VALUES ('New order created: ' || NEW.id::TEXT || ' for customer ' || NEW.customer_id::TEXT, NOW());
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_after_insert
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_orders_after_insert_fn();

-- Trigger function: log product price changes and update stock timestamps
CREATE FUNCTION public.trg_products_after_update_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.price IS DISTINCT FROM NEW.price THEN
        INSERT INTO public.error_log (message, occurred_at)
        VALUES ('Price changed for product: ' || NEW.name || ' from ' || OLD.price::TEXT || ' to ' || NEW.price::TEXT, NOW());

        UPDATE inventory.stock
        SET last_updated = NOW()
        WHERE product_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_after_update
AFTER UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.trg_products_after_update_fn();

-- Trigger function: instead of deleting stock, set quantity to 0
CREATE FUNCTION inventory.trg_stock_before_delete_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Instead of deleting, set quantity to 0
    UPDATE inventory.stock
    SET quantity = 0, last_updated = NOW()
    WHERE id = OLD.id;
    RETURN NULL;  -- Returning NULL cancels the DELETE
END;
$$;

CREATE TRIGGER trg_stock_before_delete
BEFORE DELETE ON inventory.stock
FOR EACH ROW
EXECUTE FUNCTION inventory.trg_stock_before_delete_fn();

-- ============================================================
-- SEQUENCES
-- ============================================================

CREATE SEQUENCE public.seq_order_number
    AS INT
    START WITH 10000
    INCREMENT BY 1
    MINVALUE 10000
    MAXVALUE 99999
    NO CYCLE;

CREATE SEQUENCE public.seq_invoice_number
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 9999999999
    CYCLE;

CREATE SEQUENCE inventory.seq_batch_id
    AS INT
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;

-- ============================================================
-- DOMAINS (equivalent to SQL Server CREATE TYPE ... FROM)
-- ============================================================

CREATE DOMAIN public.email_address AS VARCHAR(200) NOT NULL;

CREATE DOMAIN public.money_amount AS NUMERIC(18,2);

-- Note: Table-valued UDT (OrderItemTableType) is omitted; PG doesn't support them

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO public.countries (code, name) VALUES
('AT', 'Austria'), ('DE', 'Germany'), ('US', 'United States'),
('GB', 'United Kingdom'), ('FR', 'France'), ('JP', 'Japan');

INSERT INTO public.categories (name, description) VALUES
('Electronics', 'Electronic devices and accessories'),
('Books', 'Physical and digital books'),
('Clothing', 'Apparel and fashion'),
('Food', 'Groceries and gourmet food');

INSERT INTO public.roles (role_name) VALUES ('Admin'), ('Customer'), ('Support');

INSERT INTO public.customers (first_name, last_name, email, country_id) VALUES
('Max', 'Mustermann', 'max@example.com', 1),
('Jane', 'Smith', 'jane@example.com', 3),
('Pierre', 'Dupont', 'pierre@example.com', 5);

INSERT INTO public.users (username, email, role_id, customer_id) VALUES
('admin', 'admin@test.com', 1, NULL),
('max_m', 'max@example.com', 2, 1),
('jane_s', 'jane@example.com', 2, 2);

INSERT INTO public.products (name, sku, price, category_id) VALUES
('Laptop Pro', 'ELEC-001', 1299.99, 1),
('Wireless Mouse', 'ELEC-002', 29.99, 1),
('C# in Depth', 'BOOK-001', 49.99, 2),
('Winter Jacket', 'CLTH-001', 89.99, 3);

INSERT INTO public.suppliers (company_name, contact_email, country_id) VALUES
('TechSupply GmbH', 'info@techsupply.de', 2),
('BookWorld Inc', 'sales@bookworld.com', 3);

INSERT INTO public.product_suppliers (product_id, supplier_id, cost_price, lead_time_days) VALUES
(1, 1, 800.00, 14), (2, 1, 12.00, 7), (3, 2, 20.00, 5);

-- Disable the order insert trigger temporarily to avoid error_log entries during seed
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_after_insert;

INSERT INTO public.orders (customer_id, order_date, status, total_amount, shipping_country_id) VALUES
(1, '2025-01-15', 'Completed', 1329.98, 1),
(2, '2025-02-01', 'Shipped', 49.99, 3),
(1, '2025-02-10', 'Pending', 89.99, 1);

ALTER TABLE public.orders ENABLE TRIGGER trg_orders_after_insert;

INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, discount) VALUES
(1, 1, 1, 1299.99, 0), (1, 2, 1, 29.99, 0),
(2, 3, 1, 49.99, 0),
(3, 4, 1, 89.99, 0);

INSERT INTO public.payments (order_id, amount, payment_method, paid_at, status) VALUES
(1, 1329.98, 'CreditCard', '2025-01-15 10:30:00', 'Completed'),
(2, 49.99, 'PayPal', '2025-02-01 14:00:00', 'Completed');

INSERT INTO public.reviews (product_id, customer_id, rating, comment) VALUES
(1, 1, 5, 'Excellent laptop!'),
(3, 2, 4, 'Great book, very detailed.'),
(2, 1, 3, 'Decent mouse, nothing special.');

INSERT INTO public.shipping_addresses (customer_id, street, city, zip_code, country_id) VALUES
(1, 'Hauptstrasse 1', 'Wien', '1010', 1),
(2, '123 Main St', 'New York', '10001', 3);

INSERT INTO public.app_settings (setting_key, setting_value) VALUES
('SiteName', 'TestShop'), ('MaintenanceMode', 'false');

INSERT INTO inventory.warehouses (name, country_id) VALUES
('Wien Central', 1), ('Berlin Hub', 2);

INSERT INTO inventory.stock (warehouse_id, product_id, quantity) VALUES
(1, 1, 50), (1, 2, 200), (1, 3, 75),
(2, 1, 30), (2, 4, 100);

INSERT INTO external.external_config (config_key, config_value) VALUES
('MaxRetries', '3'), ('Timeout', '30');

-- Seed data for implicit FK pattern tables
INSERT INTO public.invoices (orderid, amount) VALUES
(1, 1329.98), (2, 49.99);

INSERT INTO public.transfers (source_customer_id, target_customer_id, ref_product_id, amount) VALUES
(1, 2, 1, 100.00), (2, 3, 3, 50.00);

INSERT INTO public.audit_entries (customer_key, product_key, action) VALUES
(1, 1, 'Purchase'), (2, 3, 'Review');

INSERT INTO public.shipments (order_no, customer_number, country_code) VALUES
(1, 1, 1), (2, 2, 3);

INSERT INTO public.mismatch_test (customer_id, order_id) VALUES
('abc123', 1), ('def456', 2);

-- ============================================================
-- Summary
-- ============================================================
-- Tables: 22 (3 schemas: public, inventory, external)
-- Views: 5
-- Functions: 7 (scalar, table-returning, plpgsql)
-- Procedures (as functions): 10
-- Triggers: 3 (with trigger functions)
-- Sequences: 3
-- Domains: 2 (EmailAddress, MoneyAmount)
-- Synonyms: omitted (PG doesn't support them)
-- Cross-schema refs: 3 (to external schema)
-- Table-valued UDT: omitted (PG doesn't support them)
