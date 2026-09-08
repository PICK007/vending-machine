const express = require("express");
const mysql = require("mysql2");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// =========================
// MySQL
// =========================

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT || 3306
});

db.connect((err) => {
  if (err) {
    console.error("MySQL Error:", err);
    return;
  }

  console.log("MySQL Connected");
});

// =========================
// USER TOKEN
// =========================

const userTokens = new Map();

// =========================
// ADMIN
// =========================

const adminTokens = new Set();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "1234";

// =========================
// ESP32
// =========================

let esp32LastHeartbeat = 0;

const ESP32_TIMEOUT = 15000;

// =========================
// COMMAND QUEUE
// =========================

const commandQueue = [];

// =========================
// PENDING ORDERS
// =========================

const pendingOrders = new Map();

// =========================
// ESP32 ONLINE
// =========================

function isESP32Online() {
  return (
    esp32LastHeartbeat > 0 &&
    Date.now() - esp32LastHeartbeat < ESP32_TIMEOUT
  );
}

// =========================
// USER AUTH
// =========================

function requireUser(req, res, next) {

  const auth =
    req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {

    return res.status(401).json({
      success: false,
      message: "กรุณาเข้าสู่ระบบ"
    });
  }

  const token =
    auth.substring(7);

  const username =
    userTokens.get(token);

  if (!username) {

    return res.status(401).json({
      success: false,
      message: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่"
    });
  }

  req.username = username;

  next();
}

// =========================
// LOGIN
// =========================

app.post("/login", (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (!username || !password) {

    return res.status(400).json({
      success: false,
      message: "กรอก Username และ Password"
    });
  }

  db.query(
    "SELECT id, username, password FROM users WHERE username = ? LIMIT 1",
    [username],
    (err, rows) => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          success: false,
          message: "Database Error"
        });
      }

      if (rows.length === 0) {

        return res.status(401).json({
          success: false,
          message: "ไม่พบ Username นี้"
        });
      }

      if (rows[0].password !== password) {

        return res.status(401).json({
          success: false,
          message: "Password ไม่ถูกต้อง"
        });
      }

      db.query(
        `INSERT INTO wallet (username, balance)
         VALUES (?, 0)
         ON DUPLICATE KEY UPDATE username = VALUES(username)`,
        [username],
        (walletErr) => {

          if (walletErr) {

            console.error(walletErr);

            return res.status(500).json({
              success: false,
              message: "สร้าง Wallet ไม่สำเร็จ"
            });
          }

          const token =
            crypto.randomBytes(32).toString("hex");

          userTokens.set(
            token,
            username
          );

          res.json({
            success: true,
            token,
            username
          });
        }
      );
    }
  );
});

// =========================
// REGISTER
// =========================

app.post("/register", (req, res) => {

  const username =
    String(req.body.username || "").trim();

  const password =
    String(req.body.password || "");

  if (!username || !password) {

    return res.json({
      success: false,
      message: "กรุณากรอก Username และ Password"
    });
  }

  if (username.length < 3) {

    return res.json({
      success: false,
      message: "Username ต้องมีอย่างน้อย 3 ตัว"
    });
  }

  if (password.length < 4) {

    return res.json({
      success: false,
      message: "Password ต้องมีอย่างน้อย 4 ตัว"
    });
  }

  db.query(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    [username],
    (err, rows) => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          success: false,
          message: "ตรวจสอบ Username ไม่สำเร็จ"
        });
      }

      if (rows.length > 0) {

        return res.json({
          success: false,
          message: "Username นี้มีคนใช้แล้ว"
        });
      }

      db.query(
        `INSERT INTO users
         (username, password, wallet)
         VALUES (?, ?, 0)`,
        [username, password],
        (err) => {

          if (err) {

            console.error(err);

            return res.status(500).json({
              success: false,
              message: "สร้างบัญชีไม่สำเร็จ"
            });
          }

          db.query(
            `INSERT INTO wallet
             (username, balance)
             VALUES (?, 0)`,
            [username],
            (err) => {

              if (err) {

                db.query(
                  "DELETE FROM users WHERE username = ?",
                  [username]
                );

                return res.status(500).json({
                  success: false,
                  message: "สร้าง Wallet ไม่สำเร็จ"
                });
              }

              res.json({
                success: true,
                message: "สมัครสมาชิกสำเร็จ"
              });
            }
          );
        }
      );
    }
  );
});

// =========================
// LOGOUT
// =========================

app.post("/logout", requireUser, (req, res) => {

  const auth =
    req.headers.authorization || "";

  const token =
    auth.substring(7);

  userTokens.delete(token);

  res.json({
    success: true
  });
});

// =========================
// CURRENT USER
// =========================

app.get("/me", requireUser, (req, res) => {

  res.json({
    success: true,
    username: req.username
  });
});

// =========================
// ADMIN LOGIN
// =========================

app.post("/admin/login", (req, res) => {

  const password =
    String(req.body.password || "");

  if (password !== ADMIN_PASSWORD) {

    return res.status(401).json({
      success: false,
      message: "รหัสผ่าน Admin ผิด"
    });
  }

  const token =
    crypto.randomBytes(32).toString("hex");

  adminTokens.add(token);

  res.json({
    success: true,
    token
  });
});

// =========================
// ADMIN AUTH
// =========================

function requireAdmin(req, res, next) {

  const token =
    req.headers["x-admin-token"];

  if (!token || !adminTokens.has(token)) {

    return res.status(401).json({
      success: false,
      message: "ไม่ได้รับอนุญาต"
    });
  }

  next();
}

// =========================
// ADMIN LOGOUT
// =========================

app.post("/admin/logout", requireAdmin, (req, res) => {

  const token =
    req.headers["x-admin-token"];

  adminTokens.delete(token);

  res.json({
    success: true
  });
});

// =========================
// ESP32 HEARTBEAT
// =========================

app.post("/esp32/heartbeat", (req, res) => {

  esp32LastHeartbeat = Date.now();

  res.json({
    success: true,
    online: true,
    time: esp32LastHeartbeat
  });
});

// =========================
// ESP32 STATUS
// =========================

app.get("/esp32/status", (req, res) => {

  const online =
    isESP32Online();

  res.json({
    online,
    lastHeartbeat:
      esp32LastHeartbeat || null
  });
});

// =========================
// PRODUCTS
// =========================

app.get("/products", (req, res) => {

  db.query(
    `SELECT id, name, price, stock
     FROM products
     ORDER BY id`,
    (err, rows) => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          success: false,
          message: "Database Error"
        });
      }

      res.json(rows);
    }
  );
});

// =========================
// BUY PRODUCT
// =========================

app.post("/buy/:id", requireUser, (req, res) => {

  const productId =
    Number(req.params.id);

  const username =
    req.username;

  // =========================
  // CHECK ESP32
  // =========================

  if (!isESP32Online()) {

    return res.status(503).json({
      success: false,
      message: "ตู้ Offline กรุณารอสักครู่"
    });
  }

  db.beginTransaction((err) => {

    if (err) {

      return res.status(500).json({
        success: false,
        message: "Transaction Error"
      });
    }

    db.query(
      `SELECT name, price, stock
       FROM products
       WHERE id = ?
       FOR UPDATE`,
      [productId],
      (err, products) => {

        if (err) {

          return db.rollback(() => {

            res.status(500).json({
              success: false,
              message: "Database Error"
            });

          });
        }

        if (products.length === 0) {

          return db.rollback(() => {

            res.status(404).json({
              success: false,
              message: "ไม่พบสินค้า"
            });

          });
        }

        const product =
          products[0];

        if (product.stock <= 0) {

          return db.rollback(() => {

            res.status(400).json({
              success: false,
              message: "สินค้าหมด"
            });

          });
        }

        db.query(
          `SELECT balance
           FROM wallet
           WHERE username = ?
           FOR UPDATE`,
          [username],
          (err, wallets) => {

            if (err) {

              return db.rollback(() => {

                res.status(500).json({
                  success: false,
                  message: "Database Error"
                });

              });
            }

            if (wallets.length === 0) {

              return db.rollback(() => {

                res.status(400).json({
                  success: false,
                  message: "ไม่พบ Wallet"
                });

              });
            }

            const balance =
              Number(wallets[0].balance);

            const price =
              Number(product.price);

            if (balance < price) {

              return db.rollback(() => {

                res.status(400).json({
                  success: false,
                  message: "เงินไม่พอ",
                  balance
                });

              });
            }

            const newBalance =
              balance - price;

            db.query(
              `UPDATE wallet
               SET balance = ?
               WHERE username = ?`,
              [newBalance, username],
              (err) => {

                if (err) {

                  return db.rollback(() => {

                    res.status(500).json({
                      success: false,
                      message: "หักเงินไม่สำเร็จ"
                    });

                  });
                }

                db.query(
                  `UPDATE products
                   SET stock = stock - 1
                   WHERE id = ?`,
                  [productId],
                  (err) => {

                    if (err) {

                      return db.rollback(() => {

                        res.status(500).json({
                          success: false,
                          message: "ลด Stock ไม่สำเร็จ"
                        });

                      });
                    }

                    db.query(
                      `INSERT INTO purchase_history
                       (username, product_id, product_name, price)
                       VALUES (?, ?, ?, ?)`,
                      [
                        username,
                        productId,
                        product.name,
                        price
                      ],
                      (err) => {

                        if (err) {

                          return db.rollback(() => {

                            res.status(500).json({
                              success: false,
                              message:
                                "บันทึกประวัติไม่สำเร็จ"
                            });

                          });
                        }

                        db.commit((err) => {

                          if (err) {

                            return db.rollback(() => {

                              res.status(500).json({
                                success: false,
                                message:
                                  "Commit Error"
                              });

                            });
                          }

                          // =========================
                          // CREATE ORDER
                          // =========================

                          const orderId =
                            "ORDER-" +
                            Date.now() +
                            "-" +
                            crypto
                              .randomBytes(4)
                              .toString("hex");

                          pendingOrders.set(
                            orderId,
                            {
                              username,
                              productId,
                              price,
                              createdAt: Date.now()
                            }
                          );

                          commandQueue.push({
                            orderId,
                            productId
                          });

                          res.json({
                            success: true,
                            message: "ซื้อสำเร็จ",
                            orderId,
                            product: product.name,
                            price,
                            balance: newBalance
                          });

                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

// =========================
// ESP32 GET COMMAND
// =========================

app.get("/command", (req, res) => {

  esp32LastHeartbeat =
    Date.now();

  const command =
    commandQueue.shift();

  if (!command) {

    return res.json({
      command: 0
    });
  }

  res.json({
    command: command.productId,
    orderId: command.orderId
  });
});

// =========================
// ESP32 DISPENSE RESULT
// =========================

app.post("/dispense-result", (req, res) => {

  const orderId =
    String(req.body.orderId || "");

  const success =
    req.body.success === true;

  if (!orderId) {

    return res.status(400).json({
      success: false,
      message: "ไม่มี Order ID"
    });
  }

  const order =
    pendingOrders.get(orderId);

  if (!order) {

    return res.status(404).json({
      success: false,
      message: "ไม่พบ Order"
    });
  }

  // =========================
  // SUCCESS
  // =========================

  if (success) {

    pendingOrders.delete(orderId);

    console.log(
      "DISPENSE SUCCESS:",
      orderId
    );

    return res.json({
      success: true,
      message: "บันทึกการจ่ายสินค้าสำเร็จ"
    });
  }

  // =========================
  // FAILED
  // REFUND + STOCK
  // =========================

  db.beginTransaction((err) => {

    if (err) {

      return res.status(500).json({
        success: false,
        message: "Refund Transaction Error"
      });
    }

    db.query(
      `UPDATE wallet
       SET balance = balance + ?
       WHERE username = ?`,
      [
        order.price,
        order.username
      ],
      (err) => {

        if (err) {

          return db.rollback(() => {

            res.status(500).json({
              success: false,
              message: "คืนเงินไม่สำเร็จ"
            });

          });
        }

        db.query(
          `UPDATE products
           SET stock = stock + 1
           WHERE id = ?`,
          [order.productId],
          (err) => {

            if (err) {

              return db.rollback(() => {

                res.status(500).json({
                  success: false,
                  message: "คืน Stock ไม่สำเร็จ"
                });

              });
            }

            db.commit((err) => {

              if (err) {

                return db.rollback(() => {

                  res.status(500).json({
                    success: false,
                    message: "Refund Commit Error"
                  });

                });
              }

              pendingOrders.delete(
                orderId
              );

              console.log(
                "DISPENSE FAILED - REFUNDED:",
                orderId
              );

              res.json({
                success: true,
                refunded: true,
                amount: order.price
              });

            });
          }
        );
      }
    );
  });
});

// =========================
// WALLET
// =========================

app.get("/wallet", requireUser, (req, res) => {

  db.query(
    `SELECT balance
     FROM wallet
     WHERE username = ?
     LIMIT 1`,
    [req.username],
    (err, rows) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Database Error"
        });
      }

      if (rows.length === 0) {

        return res.status(404).json({
          success: false,
          message: "ไม่พบ Wallet"
        });
      }

      res.json({
        username: req.username,
        balance:
          Number(rows[0].balance)
      });
    }
  );
});

// =========================
// CREATE TOPUP
// =========================

app.post(
  "/wallet/topup/create",
  requireUser,
  (req, res) => {

    const amount =
      Number(req.body.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({
        success: false,
        message: "จำนวนเงินไม่ถูกต้อง"
      });
    }

    const transactionId =
      "TOPUP-" +
      Date.now() +
      "-" +
      crypto
        .randomBytes(4)
        .toString("hex");

    db.query(
      `INSERT INTO topup_transactions
       (transaction_id, username, amount, status)
       VALUES (?, ?, ?, 'PENDING')`,
      [
        transactionId,
        req.username,
        amount
      ],
      (err) => {

        if (err) {

          console.error(err);

          return res.status(500).json({
            success: false,
            message:
              "สร้างรายการเติมเงินไม่สำเร็จ"
          });
        }

        res.json({
          success: true,
          transactionId,
          amount
        });
      }
    );
  }
);

// =========================
// SIMULATE PAYMENT
// =========================

app.post(
  "/wallet/topup/pay-simulate/:transactionId",
  requireUser,
  (req, res) => {

    const transactionId =
      req.params.transactionId;

    db.beginTransaction((err) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Transaction Error"
        });
      }

      db.query(
        `SELECT amount, status
         FROM topup_transactions
         WHERE transaction_id = ?
         AND username = ?
         FOR UPDATE`,
        [
          transactionId,
          req.username
        ],
        (err, rows) => {

          if (err) {

            return db.rollback(() => {

              res.status(500).json({
                success: false,
                message: "Database Error"
              });

            });
          }

          if (rows.length === 0) {

            return db.rollback(() => {

              res.status(404).json({
                success: false,
                message:
                  "ไม่พบรายการเติมเงิน"
              });

            });
          }

          const transaction =
            rows[0];

          if (
            transaction.status === "SUCCESS"
          ) {

            return db.rollback(() => {

              res.status(400).json({
                success: false,
                message:
                  "รายการนี้ชำระแล้ว"
              });

            });
          }

          const amount =
            Number(transaction.amount);

          db.query(
            `UPDATE wallet
             SET balance = balance + ?
             WHERE username = ?`,
            [
              amount,
              req.username
            ],
            (err) => {

              if (err) {

                return db.rollback(() => {

                  res.status(500).json({
                    success: false,
                    message:
                      "เพิ่มเงินไม่สำเร็จ"
                  });

                });
              }

              db.query(
                `UPDATE topup_transactions
                 SET status = 'SUCCESS'
                 WHERE transaction_id = ?
                 AND username = ?`,
                [
                  transactionId,
                  req.username
                ],
                (err) => {

                  if (err) {

                    return db.rollback(() => {

                      res.status(500).json({
                        success: false,
                        message:
                          "อัปเดตสถานะไม่สำเร็จ"
                      });

                    });
                  }

                  db.commit((err) => {

                    if (err) {

                      return db.rollback(() => {

                        res.status(500).json({
                          success: false,
                          message:
                            "Commit Error"
                        });

                      });
                    }

                    db.query(
                      `SELECT balance
                       FROM wallet
                       WHERE username = ?
                       LIMIT 1`,
                      [req.username],
                      (err, walletRows) => {

                        if (
                          err ||
                          walletRows.length === 0
                        ) {

                          return res.status(500).json({
                            success: false,
                            message:
                              "อ่านยอดเงินไม่สำเร็จ"
                          });
                        }

                        res.json({
                          success: true,
                          amount,
                          balance:
                            Number(
                              walletRows[0].balance
                            )
                        });

                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    });
  }
);

// =========================
// TOPUP HISTORY
// =========================

app.get(
  "/wallet/topup/history",
  requireUser,
  (req, res) => {

    db.query(
      `SELECT transaction_id,
              amount,
              status,
              created_at
       FROM topup_transactions
       WHERE username = ?
       ORDER BY created_at DESC`,
      [req.username],
      (err, rows) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        res.json(rows);
      }
    );
  }
);

// =========================
// PURCHASE HISTORY
// =========================

app.get(
  "/purchase/history",
  requireUser,
  (req, res) => {

    db.query(
      `SELECT *
       FROM purchase_history
       WHERE username = ?
       ORDER BY created_at DESC`,
      [req.username],
      (err, rows) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        res.json(rows);
      }
    );
  }
);

// =========================
// ADD STOCK
// =========================

app.post(
  "/stock/:id/add",
  requireAdmin,
  (req, res) => {

    const productId =
      Number(req.params.id);

    const amount =
      Number(req.body.amount);

    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({
        success: false,
        message: "จำนวนไม่ถูกต้อง"
      });
    }

    db.query(
      `UPDATE products
       SET stock = stock + ?
       WHERE id = ?`,
      [
        amount,
        productId
      ],
      (err, result) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        if (result.affectedRows === 0) {

          return res.status(404).json({
            success: false,
            message: "ไม่พบสินค้า"
          });
        }

        res.json({
          success: true,
          message: "เพิ่ม Stock แล้ว"
        });
      }
    );
  }
);

// =========================
// ADMIN PRODUCTS
// =========================

app.post(
  "/admin/product/:id/price",
  requireAdmin,
  (req, res) => {

    const productId =
      Number(req.params.id);

    const price =
      Number(req.body.price);

    if (
      !Number.isFinite(price) ||
      price < 0
    ) {

      return res.status(400).json({
        success: false,
        message: "ราคาไม่ถูกต้อง"
      });
    }

    db.query(
      `UPDATE products
       SET price = ?
       WHERE id = ?`,
      [
        price,
        productId
      ],
      (err, result) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        if (result.affectedRows === 0) {

          return res.status(404).json({
            success: false,
            message: "ไม่พบสินค้า"
          });
        }

        res.json({
          success: true,
          message: "เปลี่ยนราคาแล้ว"
        });
      }
    );
  }
);

// =========================
// ADMIN STOCK REMOVE
// =========================

app.post(
  "/admin/product/:id/remove-stock",
  requireAdmin,
  (req, res) => {

    const productId =
      Number(req.params.id);

    const amount =
      Number(req.body.amount);

    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {

      return res.status(400).json({
        success: false,
        message: "จำนวนไม่ถูกต้อง"
      });
    }

    db.query(
      `UPDATE products
       SET stock =
         CASE
           WHEN stock >= ? THEN stock - ?
           ELSE 0
         END
       WHERE id = ?`,
      [
        amount,
        amount,
        productId
      ],
      (err, result) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        if (result.affectedRows === 0) {

          return res.status(404).json({
            success: false,
            message: "ไม่พบสินค้า"
          });
        }

        res.json({
          success: true,
          message: "ลด Stock แล้ว"
        });
      }
    );
  }
);

// =========================
// ADMIN SALES
// =========================

app.get(
  "/admin/sales",
  requireAdmin,
  (req, res) => {

    db.query(
      `SELECT
         COUNT(*) AS total_orders,
         COALESCE(SUM(price), 0) AS total_sales
       FROM purchase_history`,
      (err, rows) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        res.json({
          success: true,
          totalOrders:
            Number(rows[0].total_orders),
          totalSales:
            Number(rows[0].total_sales)
        });
      }
    );
  }
);

// =========================
// ADMIN PURCHASE HISTORY
// =========================

app.get(
  "/admin/purchases",
  requireAdmin,
  (req, res) => {

    db.query(
      `SELECT *
       FROM purchase_history
       ORDER BY created_at DESC`,
      (err, rows) => {

        if (err) {

          return res.status(500).json({
            success: false,
            message: "Database Error"
          });
        }

        res.json({
          success: true,
          purchases: rows
        });
      }
    );
  }
);

// =========================
// HOME
// =========================

app.get("/", (req, res) => {

  res.sendFile(
    __dirname + "/login.html"
  );
});

// =========================
// SERVER
// =========================

app.listen(
  process.env.PORT || 3000,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "Vending Machine Server Running"
    );

    console.log(
      "================================"
    );

    console.log(
      "ระบบหลายผู้ใช้ + ESP32 Online"
    );

    console.log(
      "Admin Password:",
      ADMIN_PASSWORD
    );
  }
);