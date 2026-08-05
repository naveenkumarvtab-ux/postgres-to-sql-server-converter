-- MySQL full-cycle test schema

CREATE TABLE products (
  product_id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  price DECIMAL(10,2) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  stock_count INT UNSIGNED DEFAULT 0,
  description TEXT,
  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  order_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(10,2) DEFAULT 0.00
);

CREATE TABLE order_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- View with IFNULL and CONCAT
CREATE VIEW view_active_products AS
SELECT 
  product_id, 
  sku, 
  CONCAT(name, ' (', sku, ')') AS display_name,
  price,
  IFNULL(description, 'No description provided') AS short_desc
FROM products
WHERE is_active = 1;

-- Trigger using OLD/NEW
DELIMITER $$
CREATE TRIGGER after_order_items_insert
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
  -- Update stock count
  UPDATE products 
  SET stock_count = stock_count - NEW.quantity
  WHERE product_id = NEW.product_id;
  
  -- Update order total
  UPDATE orders
  SET total_amount = total_amount + (NEW.quantity * NEW.unit_price)
  WHERE order_id = NEW.order_id;
END$$
DELIMITER ;

-- Stored Procedure with OUT parameter and LIMIT/OFFSET paging
DELIMITER $$
CREATE PROCEDURE get_products_paged(
  IN p_limit INT,
  IN p_offset INT,
  OUT p_total_count INT
)
BEGIN
  -- Get total count
  SELECT COUNT(*) INTO p_total_count FROM products;
  
  -- Return paged list
  SELECT product_id, sku, name, price 
  FROM products
  ORDER BY name
  LIMIT p_limit OFFSET p_offset;
END$$
DELIMITER ;

-- Stored Function with SIGNAL
DELIMITER $$
CREATE FUNCTION get_product_price(p_product_id INT) 
RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
  DECLARE v_price DECIMAL(10,2);
  
  SELECT price INTO v_price FROM products WHERE product_id = p_product_id;
  
  IF v_price IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Product not found';
  END IF;
  
  RETURN v_price;
END$$
DELIMITER ;

-- Event warning check
CREATE EVENT purge_old_orders
ON SCHEDULE EVERY 1 DAY
DO
  DELETE FROM orders WHERE order_date < DATE_SUB(NOW(), INTERVAL 1 YEAR);

-- Standard DML statement with backticks
INSERT INTO `orders` (`order_id`, `customer_name`, `total_amount`) VALUES (101, 'John Doe', 150.00);

-- INSERT ... ON DUPLICATE KEY UPDATE (requires AI translation to MERGE)
INSERT INTO `products` (`product_id`, `sku`, `price`, `stock_count`) 
VALUES (1, 'SKU-001', 99.99, 100)
ON DUPLICATE KEY UPDATE `price` = VALUES(`price`), `stock_count` = `stock_count` + VALUES(`stock_count`);

-- REPLACE INTO (requires AI translation to MERGE)
REPLACE INTO `orders` (`order_id`, `customer_name`, `total_amount`) VALUES (101, 'John Doe Updated', 175.50);
