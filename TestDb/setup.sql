-- ============================================================
-- DbAnalyser Test Database
-- Demonstrates: tables, FKs, views, procedures, functions,
--               implicit relationships, cross-DB references
-- ============================================================

-- Create cross-DB target first
IF DB_ID('DbAnalyserExternal') IS NOT NULL
BEGIN
    ALTER DATABASE DbAnalyserExternal SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE DbAnalyserExternal;
END
GO

CREATE DATABASE DbAnalyserExternal;
GO

USE DbAnalyserExternal;
GO

CREATE TABLE dbo.ExternalAuditLog (
    Id INT IDENTITY PRIMARY KEY,
    Action NVARCHAR(100) NOT NULL,
    ObjectType NVARCHAR(50) NOT NULL,
    ObjectId INT NOT NULL,
    ChangedBy NVARCHAR(100) NOT NULL,
    ChangedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

CREATE TABLE dbo.ExternalConfig (
    ConfigKey NVARCHAR(100) PRIMARY KEY,
    ConfigValue NVARCHAR(MAX) NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- Now create the main test database
IF DB_ID('DbAnalyserTestDb') IS NOT NULL
BEGIN
    ALTER DATABASE DbAnalyserTestDb SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE DbAnalyserTestDb;
END
GO

CREATE DATABASE DbAnalyserTestDb;
GO

USE DbAnalyserTestDb;
GO

-- ============================================================
-- TABLES - Core (no outbound FKs)
-- ============================================================

CREATE TABLE dbo.Countries (
    Id INT IDENTITY PRIMARY KEY,
    Code CHAR(2) NOT NULL UNIQUE,
    Name NVARCHAR(100) NOT NULL
);
GO

CREATE TABLE dbo.Categories (
    Id INT IDENTITY PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    Description NVARCHAR(500) NULL
);
GO

CREATE TABLE dbo.Roles (
    Id INT IDENTITY PRIMARY KEY,
    RoleName NVARCHAR(50) NOT NULL UNIQUE
);
GO

-- ============================================================
-- TABLES - Second level
-- ============================================================

CREATE TABLE dbo.Customers (
    Id INT IDENTITY PRIMARY KEY,
    FirstName NVARCHAR(100) NOT NULL,
    LastName NVARCHAR(100) NOT NULL,
    Email NVARCHAR(200) NOT NULL UNIQUE,
    CountryId INT NOT NULL CONSTRAINT FK_Customers_Countries FOREIGN KEY REFERENCES dbo.Countries(Id),
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    IsActive BIT NOT NULL DEFAULT 1
);
GO

CREATE TABLE dbo.Users (
    Id INT IDENTITY PRIMARY KEY,
    Username NVARCHAR(100) NOT NULL UNIQUE,
    Email NVARCHAR(200) NOT NULL,
    RoleId INT NOT NULL CONSTRAINT FK_Users_Roles FOREIGN KEY REFERENCES dbo.Roles(Id),
    CustomerId INT NULL CONSTRAINT FK_Users_Customers FOREIGN KEY REFERENCES dbo.Customers(Id),
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

CREATE TABLE dbo.Products (
    Id INT IDENTITY PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    SKU NVARCHAR(50) NOT NULL UNIQUE,
    Price DECIMAL(18,2) NOT NULL,
    CategoryId INT NOT NULL CONSTRAINT FK_Products_Categories FOREIGN KEY REFERENCES dbo.Categories(Id),
    IsActive BIT NOT NULL DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

CREATE TABLE dbo.Suppliers (
    Id INT IDENTITY PRIMARY KEY,
    CompanyName NVARCHAR(200) NOT NULL,
    ContactEmail NVARCHAR(200) NULL,
    CountryId INT NOT NULL CONSTRAINT FK_Suppliers_Countries FOREIGN KEY REFERENCES dbo.Countries(Id)
);
GO

-- ============================================================
-- TABLES - Third level
-- ============================================================

CREATE TABLE dbo.ProductSuppliers (
    Id INT IDENTITY PRIMARY KEY,
    ProductId INT NOT NULL CONSTRAINT FK_ProductSuppliers_Products FOREIGN KEY REFERENCES dbo.Products(Id),
    SupplierId INT NOT NULL CONSTRAINT FK_ProductSuppliers_Suppliers FOREIGN KEY REFERENCES dbo.Suppliers(Id),
    CostPrice DECIMAL(18,2) NOT NULL,
    LeadTimeDays INT NULL,
    CONSTRAINT UQ_ProductSupplier UNIQUE (ProductId, SupplierId)
);
GO

CREATE TABLE dbo.Orders (
    Id INT IDENTITY PRIMARY KEY,
    CustomerId INT NOT NULL CONSTRAINT FK_Orders_Customers FOREIGN KEY REFERENCES dbo.Customers(Id),
    OrderDate DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    TotalAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
    ShippingCountryId INT NULL CONSTRAINT FK_Orders_Countries FOREIGN KEY REFERENCES dbo.Countries(Id)
);
GO

CREATE TABLE dbo.OrderItems (
    Id INT IDENTITY PRIMARY KEY,
    OrderId INT NOT NULL CONSTRAINT FK_OrderItems_Orders FOREIGN KEY REFERENCES dbo.Orders(Id) ON DELETE CASCADE,
    ProductId INT NOT NULL CONSTRAINT FK_OrderItems_Products FOREIGN KEY REFERENCES dbo.Products(Id),
    Quantity INT NOT NULL,
    UnitPrice DECIMAL(18,2) NOT NULL,
    Discount DECIMAL(5,2) NOT NULL DEFAULT 0
);
GO

CREATE TABLE dbo.Payments (
    Id INT IDENTITY PRIMARY KEY,
    OrderId INT NOT NULL CONSTRAINT FK_Payments_Orders FOREIGN KEY REFERENCES dbo.Orders(Id),
    Amount DECIMAL(18,2) NOT NULL,
    PaymentMethod NVARCHAR(50) NOT NULL,
    PaidAt DATETIME2 NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending'
);
GO

CREATE TABLE dbo.Reviews (
    Id INT IDENTITY PRIMARY KEY,
    ProductId INT NOT NULL CONSTRAINT FK_Reviews_Products FOREIGN KEY REFERENCES dbo.Products(Id),
    CustomerId INT NOT NULL CONSTRAINT FK_Reviews_Customers FOREIGN KEY REFERENCES dbo.Customers(Id),
    Rating INT NOT NULL CHECK (Rating BETWEEN 1 AND 5),
    Comment NVARCHAR(1000) NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- Standalone tables (orphans, no FKs)
CREATE TABLE dbo.AppSettings (
    SettingKey NVARCHAR(100) PRIMARY KEY,
    SettingValue NVARCHAR(MAX) NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- Implicit FK relationships (no constraint, but naming convention matches)
CREATE TABLE dbo.ShippingAddresses (
    Id INT IDENTITY PRIMARY KEY,
    CustomerId INT NOT NULL,
    Street NVARCHAR(200) NOT NULL,
    City NVARCHAR(100) NOT NULL,
    ZipCode NVARCHAR(20) NOT NULL,
    CountryId INT NOT NULL
);
GO

CREATE TABLE dbo.ErrorLog (
    Id INT IDENTITY PRIMARY KEY,
    Message NVARCHAR(MAX) NOT NULL,
    StackTrace NVARCHAR(MAX) NULL,
    OccurredAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- ============================================================
-- Second schema
-- ============================================================

CREATE SCHEMA inventory;
GO

CREATE TABLE inventory.Warehouses (
    Id INT IDENTITY PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL,
    CountryId INT NOT NULL CONSTRAINT FK_Warehouses_Countries FOREIGN KEY REFERENCES dbo.Countries(Id)
);
GO

CREATE TABLE inventory.Stock (
    Id INT IDENTITY PRIMARY KEY,
    WarehouseId INT NOT NULL CONSTRAINT FK_Stock_Warehouses FOREIGN KEY REFERENCES inventory.Warehouses(Id),
    ProductId INT NOT NULL CONSTRAINT FK_Stock_Products FOREIGN KEY REFERENCES dbo.Products(Id),
    Quantity INT NOT NULL DEFAULT 0,
    LastUpdated DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_WarehouseProduct UNIQUE (WarehouseId, ProductId)
);
GO

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IX_Customers_CountryId ON dbo.Customers(CountryId);
CREATE INDEX IX_Customers_Email ON dbo.Customers(Email);
CREATE INDEX IX_Products_CategoryId ON dbo.Products(CategoryId);
CREATE INDEX IX_Orders_CustomerId ON dbo.Orders(CustomerId);
CREATE INDEX IX_Orders_Status ON dbo.Orders(Status);
CREATE INDEX IX_OrderItems_OrderId ON dbo.OrderItems(OrderId);
CREATE INDEX IX_OrderItems_ProductId ON dbo.OrderItems(ProductId);
CREATE INDEX IX_Stock_ProductId ON inventory.Stock(ProductId);
GO

-- ============================================================
-- VIEWS
-- ============================================================

CREATE VIEW dbo.vw_CustomerOrders AS
SELECT
    c.Id AS CustomerId,
    c.FirstName + ' ' + c.LastName AS CustomerName,
    c.Email,
    o.Id AS OrderId,
    o.OrderDate,
    o.Status,
    o.TotalAmount
FROM dbo.Customers c
JOIN dbo.Orders o ON o.CustomerId = c.Id;
GO

CREATE VIEW dbo.vw_ProductCatalog AS
SELECT
    p.Id AS ProductId,
    p.Name AS ProductName,
    p.SKU,
    p.Price,
    cat.Name AS CategoryName,
    ISNULL(AVG(CAST(r.Rating AS FLOAT)), 0) AS AvgRating,
    COUNT(r.Id) AS ReviewCount
FROM dbo.Products p
JOIN dbo.Categories cat ON cat.Id = p.CategoryId
LEFT JOIN dbo.Reviews r ON r.ProductId = p.Id
WHERE p.IsActive = 1
GROUP BY p.Id, p.Name, p.SKU, p.Price, cat.Name;
GO

-- View that depends on another view
CREATE VIEW dbo.vw_OrderDetails AS
SELECT
    o.Id AS OrderId,
    co.CustomerName,
    o.OrderDate,
    o.Status,
    oi.ProductId,
    p.Name AS ProductName,
    oi.Quantity,
    oi.UnitPrice,
    oi.Discount,
    (oi.Quantity * oi.UnitPrice * (1 - oi.Discount / 100)) AS LineTotal
FROM dbo.Orders o
JOIN dbo.vw_CustomerOrders co ON co.OrderId = o.Id
JOIN dbo.OrderItems oi ON oi.OrderId = o.Id
JOIN dbo.Products p ON p.Id = oi.ProductId;
GO

CREATE VIEW inventory.vw_StockOverview AS
SELECT
    w.Name AS WarehouseName,
    p.Name AS ProductName,
    p.SKU,
    s.Quantity,
    s.LastUpdated,
    cn.Name AS Country
FROM inventory.Stock s
JOIN inventory.Warehouses w ON w.Id = s.WarehouseId
JOIN dbo.Products p ON p.Id = s.ProductId
JOIN dbo.Countries cn ON cn.Id = w.CountryId;
GO

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Scalar function
CREATE FUNCTION dbo.fn_GetCustomerTotalSpend(@CustomerId INT)
RETURNS DECIMAL(18,2)
AS
BEGIN
    DECLARE @Total DECIMAL(18,2);
    SELECT @Total = ISNULL(SUM(TotalAmount), 0)
    FROM dbo.Orders
    WHERE CustomerId = @CustomerId AND Status != 'Cancelled';
    RETURN @Total;
END;
GO

-- Inline table-valued function
CREATE FUNCTION dbo.fn_GetProductsByCategory(@CategoryId INT)
RETURNS TABLE
AS
RETURN
    SELECT p.Id, p.Name, p.SKU, p.Price, cat.Name AS CategoryName
    FROM dbo.Products p
    JOIN dbo.Categories cat ON cat.Id = p.CategoryId
    WHERE p.CategoryId = @CategoryId AND p.IsActive = 1;
GO

-- Multi-statement table-valued function
CREATE FUNCTION dbo.fn_GetCustomerOrderHistory(@CustomerId INT)
RETURNS @Result TABLE (
    OrderId INT,
    OrderDate DATETIME2,
    Status NVARCHAR(20),
    TotalAmount DECIMAL(18,2),
    ItemCount INT
)
AS
BEGIN
    INSERT INTO @Result
    SELECT
        o.Id,
        o.OrderDate,
        o.Status,
        o.TotalAmount,
        COUNT(oi.Id)
    FROM dbo.Orders o
    LEFT JOIN dbo.OrderItems oi ON oi.OrderId = o.Id
    WHERE o.CustomerId = @CustomerId
    GROUP BY o.Id, o.OrderDate, o.Status, o.TotalAmount;
    RETURN;
END;
GO

-- Function that references a view
CREATE FUNCTION inventory.fn_GetLowStock(@Threshold INT)
RETURNS TABLE
AS
RETURN
    SELECT WarehouseName, ProductName, SKU, Quantity, Country
    FROM inventory.vw_StockOverview
    WHERE Quantity < @Threshold;
GO

-- ============================================================
-- STORED PROCEDURES
-- ============================================================

CREATE PROCEDURE dbo.usp_CreateOrder
    @CustomerId INT,
    @ShippingCountryId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Customers WHERE Id = @CustomerId AND IsActive = 1)
        THROW 50001, 'Customer not found or inactive', 1;
    INSERT INTO dbo.Orders (CustomerId, ShippingCountryId)
    VALUES (@CustomerId, @ShippingCountryId);
    SELECT SCOPE_IDENTITY() AS NewOrderId;
END;
GO

CREATE PROCEDURE dbo.usp_AddOrderItem
    @OrderId INT,
    @ProductId INT,
    @Quantity INT,
    @Discount DECIMAL(5,2) = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Price DECIMAL(18,2);
    SELECT @Price = Price FROM dbo.Products WHERE Id = @ProductId AND IsActive = 1;
    IF @Price IS NULL
        THROW 50002, 'Product not found or inactive', 1;
    INSERT INTO dbo.OrderItems (OrderId, ProductId, Quantity, UnitPrice, Discount)
    VALUES (@OrderId, @ProductId, @Quantity, @Price, @Discount);
    UPDATE dbo.Orders
    SET TotalAmount = (
        SELECT SUM(Quantity * UnitPrice * (1 - Discount / 100))
        FROM dbo.OrderItems WHERE OrderId = @OrderId
    )
    WHERE Id = @OrderId;
END;
GO

-- Procedure that uses a view and a function
CREATE PROCEDURE dbo.usp_GetCustomerDashboard
    @CustomerId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT FirstName, LastName, Email FROM dbo.Customers WHERE Id = @CustomerId;
    SELECT dbo.fn_GetCustomerTotalSpend(@CustomerId) AS TotalSpend;
    SELECT TOP 10 OrderId, OrderDate, Status, TotalAmount
    FROM dbo.vw_CustomerOrders
    WHERE CustomerId = @CustomerId
    ORDER BY OrderDate DESC;
END;
GO

CREATE PROCEDURE inventory.usp_UpdateStock
    @WarehouseId INT,
    @ProductId INT,
    @QuantityChange INT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inventory.Stock WHERE WarehouseId = @WarehouseId AND ProductId = @ProductId)
    BEGIN
        UPDATE inventory.Stock
        SET Quantity = Quantity + @QuantityChange, LastUpdated = GETUTCDATE()
        WHERE WarehouseId = @WarehouseId AND ProductId = @ProductId;
    END
    ELSE
    BEGIN
        INSERT INTO inventory.Stock (WarehouseId, ProductId, Quantity)
        VALUES (@WarehouseId, @ProductId, @QuantityChange);
    END
END;
GO

-- ============================================================
-- CROSS-DATABASE REFERENCES
-- ============================================================

CREATE PROCEDURE dbo.usp_LogAuditAction
    @Action NVARCHAR(100),
    @ObjectType NVARCHAR(50),
    @ObjectId INT,
    @ChangedBy NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO DbAnalyserExternal.dbo.ExternalAuditLog (Action, ObjectType, ObjectId, ChangedBy)
    VALUES (@Action, @ObjectType, @ObjectId, @ChangedBy);
END;
GO

CREATE PROCEDURE dbo.usp_GetExternalConfig
    @ConfigKey NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT ConfigKey, ConfigValue, UpdatedAt
    FROM DbAnalyserExternal.dbo.ExternalConfig
    WHERE ConfigKey = @ConfigKey;
END;
GO

CREATE FUNCTION dbo.fn_GetConfigValue(@Key NVARCHAR(100))
RETURNS NVARCHAR(MAX)
AS
BEGIN
    DECLARE @Val NVARCHAR(MAX);
    SELECT @Val = ConfigValue
    FROM DbAnalyserExternal.dbo.ExternalConfig
    WHERE ConfigKey = @Key;
    RETURN @Val;
END;
GO

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER dbo.trg_Orders_AfterInsert
ON dbo.Orders
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    -- Log new orders to ErrorLog for auditing
    INSERT INTO dbo.ErrorLog (Message, OccurredAt)
    SELECT 'New order created: ' + CAST(i.Id AS NVARCHAR(20)) + ' for customer ' + CAST(i.CustomerId AS NVARCHAR(20)),
           GETUTCDATE()
    FROM inserted i;
END;
GO

CREATE TRIGGER dbo.trg_Products_AfterUpdate
ON dbo.Products
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    -- When a product price changes, log it and update stock timestamps
    IF UPDATE(Price)
    BEGIN
        INSERT INTO dbo.ErrorLog (Message, OccurredAt)
        SELECT 'Price changed for product: ' + i.Name + ' from ' + CAST(d.Price AS NVARCHAR(20)) + ' to ' + CAST(i.Price AS NVARCHAR(20)),
               GETUTCDATE()
        FROM inserted i
        JOIN deleted d ON d.Id = i.Id;

        UPDATE inventory.Stock
        SET LastUpdated = GETUTCDATE()
        WHERE ProductId IN (SELECT Id FROM inserted);
    END
END;
GO

CREATE TRIGGER inventory.trg_Stock_InsteadOfDelete
ON inventory.Stock
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;
    -- Instead of deleting, set quantity to 0
    UPDATE inventory.Stock
    SET Quantity = 0, LastUpdated = GETUTCDATE()
    WHERE Id IN (SELECT Id FROM deleted);
END;
GO

-- ============================================================
-- SYNONYMS
-- ============================================================

-- Local synonym
CREATE SYNONYM dbo.syn_CustomerOrders FOR dbo.vw_CustomerOrders;
GO

CREATE SYNONYM dbo.syn_Products FOR dbo.Products;
GO

-- Cross-database synonym
CREATE SYNONYM dbo.syn_ExternalAudit FOR DbAnalyserExternal.dbo.ExternalAuditLog;
GO

CREATE SYNONYM dbo.syn_ExternalConfig FOR DbAnalyserExternal.dbo.ExternalConfig;
GO

-- ============================================================
-- SEQUENCES
-- ============================================================

CREATE SEQUENCE dbo.seq_OrderNumber
    AS INT
    START WITH 10000
    INCREMENT BY 1
    MINVALUE 10000
    MAXVALUE 99999
    NO CYCLE;
GO

CREATE SEQUENCE dbo.seq_InvoiceNumber
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 9999999999
    CYCLE;
GO

CREATE SEQUENCE inventory.seq_BatchId
    AS INT
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;
GO

-- ============================================================
-- USER-DEFINED TYPES
-- ============================================================

CREATE TYPE dbo.EmailAddress FROM NVARCHAR(200) NOT NULL;
GO

CREATE TYPE dbo.MoneyAmount FROM DECIMAL(18,2) NULL;
GO

CREATE TYPE dbo.OrderItemTableType AS TABLE (
    ProductId INT NOT NULL,
    Quantity INT NOT NULL,
    UnitPrice DECIMAL(18,2) NOT NULL,
    Discount DECIMAL(5,2) NOT NULL DEFAULT 0
);
GO

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO dbo.Countries (Code, Name) VALUES
('AT', 'Austria'), ('DE', 'Germany'), ('US', 'United States'),
('GB', 'United Kingdom'), ('FR', 'France'), ('JP', 'Japan');

INSERT INTO dbo.Categories (Name, Description) VALUES
('Electronics', 'Electronic devices and accessories'),
('Books', 'Physical and digital books'),
('Clothing', 'Apparel and fashion'),
('Food', 'Groceries and gourmet food');

INSERT INTO dbo.Roles (RoleName) VALUES ('Admin'), ('Customer'), ('Support');

INSERT INTO dbo.Customers (FirstName, LastName, Email, CountryId) VALUES
('Max', 'Mustermann', 'max@example.com', 1),
('Jane', 'Smith', 'jane@example.com', 3),
('Pierre', 'Dupont', 'pierre@example.com', 5);

INSERT INTO dbo.Users (Username, Email, RoleId, CustomerId) VALUES
('admin', 'admin@test.com', 1, NULL),
('max_m', 'max@example.com', 2, 1),
('jane_s', 'jane@example.com', 2, 2);

INSERT INTO dbo.Products (Name, SKU, Price, CategoryId) VALUES
('Laptop Pro', 'ELEC-001', 1299.99, 1),
('Wireless Mouse', 'ELEC-002', 29.99, 1),
('C# in Depth', 'BOOK-001', 49.99, 2),
('Winter Jacket', 'CLTH-001', 89.99, 3);

INSERT INTO dbo.Suppliers (CompanyName, ContactEmail, CountryId) VALUES
('TechSupply GmbH', 'info@techsupply.de', 2),
('BookWorld Inc', 'sales@bookworld.com', 3);

INSERT INTO dbo.ProductSuppliers (ProductId, SupplierId, CostPrice, LeadTimeDays) VALUES
(1, 1, 800.00, 14), (2, 1, 12.00, 7), (3, 2, 20.00, 5);

INSERT INTO dbo.Orders (CustomerId, OrderDate, Status, TotalAmount, ShippingCountryId) VALUES
(1, '2025-01-15', 'Completed', 1329.98, 1),
(2, '2025-02-01', 'Shipped', 49.99, 3),
(1, '2025-02-10', 'Pending', 89.99, 1);

INSERT INTO dbo.OrderItems (OrderId, ProductId, Quantity, UnitPrice, Discount) VALUES
(1, 1, 1, 1299.99, 0), (1, 2, 1, 29.99, 0),
(2, 3, 1, 49.99, 0),
(3, 4, 1, 89.99, 0);

INSERT INTO dbo.Payments (OrderId, Amount, PaymentMethod, PaidAt, Status) VALUES
(1, 1329.98, 'CreditCard', '2025-01-15 10:30:00', 'Completed'),
(2, 49.99, 'PayPal', '2025-02-01 14:00:00', 'Completed');

INSERT INTO dbo.Reviews (ProductId, CustomerId, Rating, Comment) VALUES
(1, 1, 5, 'Excellent laptop!'),
(3, 2, 4, 'Great book, very detailed.'),
(2, 1, 3, 'Decent mouse, nothing special.');

INSERT INTO dbo.ShippingAddresses (CustomerId, Street, City, ZipCode, CountryId) VALUES
(1, 'Hauptstrasse 1', 'Wien', '1010', 1),
(2, '123 Main St', 'New York', '10001', 3);

INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES
('SiteName', 'TestShop'), ('MaintenanceMode', 'false');

INSERT INTO inventory.Warehouses (Name, CountryId) VALUES
('Wien Central', 1), ('Berlin Hub', 2);

INSERT INTO inventory.Stock (WarehouseId, ProductId, Quantity) VALUES
(1, 1, 50), (1, 2, 200), (1, 3, 75),
(2, 1, 30), (2, 4, 100);

INSERT INTO DbAnalyserExternal.dbo.ExternalConfig (ConfigKey, ConfigValue) VALUES
('MaxRetries', '3'), ('Timeout', '30');
GO

PRINT '=== DbAnalyserTestDb setup complete! ===';
PRINT 'Tables: 15 (2 schemas), Views: 4, Procedures: 6, Functions: 5';
PRINT 'Triggers: 3, Synonyms: 4 (2 local, 2 cross-DB), Sequences: 3, UDTs: 3';
PRINT 'Cross-DB refs: 3 (to DbAnalyserExternal)';
PRINT 'Implicit FKs: ShippingAddresses.CustomerId, ShippingAddresses.CountryId';
GO
