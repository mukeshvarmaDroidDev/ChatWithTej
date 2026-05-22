import os
import time
import logging
import psycopg2

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db_init")

def get_db_connection():
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    database = os.environ.get("POSTGRES_DB", "tej_products")
    user = os.environ.get("POSTGRES_USER", "tej_user")
    password = os.environ.get("POSTGRES_PASSWORD", "tej_password")
    
    # Retry logic to handle DB startup delays
    retries = 5
    while retries > 0:
        try:
            conn = psycopg2.connect(
                host=host,
                port=port,
                database=database,
                user=user,
                password=password
            )
            logger.info("Successfully connected to the PostgreSQL database.")
            return conn
        except Exception as e:
            logger.warning(f"Database connection failed: {e}. Retrying in 3 seconds... ({retries} left)")
            retries -= 1
            time.sleep(3)
    
    raise Exception("Could not connect to the PostgreSQL database after multiple attempts.")

def init_products_db():
    conn = None
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            # Create products table if it doesn't exist
            cur.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    brand VARCHAR(100) NOT NULL,
                    price INT NOT NULL,
                    stock INT NOT NULL,
                    rating DECIMAL(3, 2) NOT NULL,
                    description TEXT NOT NULL
                );
            """)
            conn.commit()
            logger.info("Products table verified/created.")

            # Check if any products exist
            cur.execute("SELECT COUNT(*) FROM products;")
            count = cur.fetchone()[0]
            
            if count == 0:
                logger.info("Seeding dummy products data into the products table...")
                cur.execute("""
                    INSERT INTO products
                    (name, category, brand, price, stock, rating, description)
                    VALUES
                    ('MacBook Air M2', 'Laptop', 'Apple', 114999, 12, 4.8, 'Lightweight laptop with M2 chip and 18-hour battery life'),
                    ('Dell XPS 15', 'Laptop', 'Dell', 139999, 5, 4.7, 'Premium Windows laptop for creators and developers'),
                    ('iPhone 15', 'Mobile', 'Apple', 79999, 20, 4.9, 'Apple smartphone with A16 Bionic chip'),
                    ('Samsung Galaxy S24', 'Mobile', 'Samsung', 74999, 18, 4.6, 'Flagship Android smartphone with AI camera features'),
                    ('Sony WH-1000XM5', 'Headphones', 'Sony', 29999, 10, 4.8, 'Noise cancelling wireless headphones'),
                    ('Logitech MX Master 3S', 'Accessories', 'Logitech', 9999, 25, 4.7, 'Advanced wireless mouse for productivity'),
                    ('ASUS ROG Strix G16', 'Laptop', 'ASUS', 149999, 7, 4.5, 'Gaming laptop with RTX graphics'),
                    ('iPad Air', 'Tablet', 'Apple', 59999, 15, 4.8, 'Portable tablet with M1 chip'),
                    ('Boat Rockerz 450', 'Headphones', 'Boat', 1499, 40, 4.1, 'Affordable wireless headphones'),
                    ('OnePlus 12', 'Mobile', 'OnePlus', 64999, 14, 4.5, 'High performance Android smartphone'),
                    ('HP Victus', 'Laptop', 'HP', 84999, 9, 4.3, 'Mid-range gaming and productivity laptop'),
                    ('Amazon Echo Dot', 'Smart Home', 'Amazon', 5499, 30, 4.4, 'Smart speaker with Alexa voice assistant');
                """)
                conn.commit()
                logger.info("Database seeding completed successfully.")
            else:
                logger.info(f"Products table already seeded with {count} records.")
                
    except Exception as e:
        logger.error(f"Error during database initialization: {e}")
        if conn:
            conn.rollback()
        raise e
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    init_products_db()
