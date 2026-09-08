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
// USER LOGIN TOKEN
// =========================

const userTokens = new Map();

// =========================
// ADMIN
// =========================

const adminTokens = new Set();
const ADMIN_PASSWORD = "1234";

// =========================
// ESP32 COMMAND QUEUE
// =========================

const commandQueue = [];

// =========================
// USER AUTH
// =========================

function requireUser(req, res, next) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "กรุณาเข้าสู่ระบบ"
    });
  }

  const token = auth.substring(7);
  const username = userTokens.get(token);

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
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

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

      // สร้าง Wallet ถ้ายังไม่มี
      db.query(
        "INSERT INTO wallet (username, balance) VALUES (?, 0) ON DUPLICATE KEY UPDATE username = VALUES(username)",
        [username],
        (walletErr) => {
          if (walletErr) {
            console.error(walletErr);

            return res.status(500).json({
              success: false,
              message: "สร้าง Wallet ไม่สำเร็จ"
            });
          }

          const token = crypto.randomBytes(32).toString("hex");

          userTokens.set(token, username);

          res.json({
            success: true,
            token: token,
            username: username
          });
        }
      );
    }
  );
});

// =========================
// REGISTER
// =========================
app.post("/register", async (req, res) => {

    try {

        const { username, password } = req.body;

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

        // เช็ก Username ซ้ำ
        const [existing] = await db.query(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
            [username]
        );

        if (existing.length > 0) {
            return res.json({
                success: false,
                message: "Username นี้มีคนใช้แล้ว"
            });
        }

        // สร้าง User
        await db.query(
            "INSERT INTO users (username, password, wallet) VALUES (?, ?, 0)",
            [username, password]
        );

        // สร้าง Wallet
        await db.query(
            "INSERT INTO wallet (username, balance) VALUES (?, 0)",
            [username]
        );

        res.json({
            success: true,
            message: "สมัครสมาชิกสำเร็จ"
        });

    } catch (error) {

        console.error(error);

        res.json({
            success: false,
            message: "สมัครสมาชิกไม่สำเร็จ"
        });

    }

});

// =========================
// LOGOUT
// =========================

app.post("/logout", requireUser, (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.substring(7);

  userTokens.delete(token);

  res.json({
    success: true,
    message: "ออกจากระบบแล้ว"
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
  const password = String(req.body.password || "");

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "รหัสผ่าน Admin ผิด"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  adminTokens.add(token);

  res.json({
    success: true,
    token: token
  });
});

// =========================
// ADMIN AUTH
// =========================

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];

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
  const token = req.headers["x-admin-token"];

  adminTokens.delete(token);

  res.json({
    success: true
  });
});

// =========================
// PRODUCTS
// =========================

app.get("/products", (req, res) => {
  db.query(
    "SELECT id, name, price, stock FROM products ORDER BY id",
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
  const productId = Number(req.params.id);
  const username = req.username;

  db.beginTransaction((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Transaction Error"
      });
    }

    // ล็อกสินค้า
    db.query(
      "SELECT name, price, stock FROM products WHERE id = ? FOR UPDATE",
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

        const product = products[0];

        // เช็ก Stock
        if (product.stock <= 0) {
          return db.rollback(() => {
            res.status(400).json({
              success: false,
              message: "สินค้าหมด"
            });
          });
        }

        // ล็อก Wallet ของผู้ใช้
        db.query(
          "SELECT balance FROM wallet WHERE username = ? FOR UPDATE",
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

            const balance = Number(wallets[0].balance);
            const price = Number(product.price);

            // เช็กเงิน
            if (balance < price) {
              return db.rollback(() => {
                res.status(400).json({
                  success: false,
                  message: "เงินไม่พอ",
                  balance: balance
                });
              });
            }

            const newBalance = balance - price;

            // หักเงิน
            db.query(
              "UPDATE wallet SET balance = ? WHERE username = ?",
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

                // ลด Stock
                db.query(
                  "UPDATE products SET stock = stock - 1 WHERE id = ?",
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

                    // บันทึกประวัติ
                    db.query(
                      "INSERT INTO purchase_history (username, product_id, product_name, price) VALUES (?, ?, ?, ?)",
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
                              message: "บันทึกประวัติไม่สำเร็จ"
                            });
                          });
                        }

                        // Commit
                        db.commit((err) => {
                          if (err) {
                            return db.rollback(() => {
                              res.status(500).json({
                                success: false,
                                message: "Commit Error"
                              });
                            });
                          }

                          // ส่งคำสั่งไป ESP32
                          commandQueue.push(productId);

                          res.json({
                            success: true,
                            message: "ซื้อสำเร็จ",
                            product: product.name,
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
// WALLET
// =========================

app.get("/wallet", requireUser, (req, res) => {
  db.query(
    "SELECT balance FROM wallet WHERE username = ? LIMIT 1",
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
        balance: Number(rows[0].balance)
      });
    }
  );
});

// =========================
// CREATE TOPUP
// =========================

app.post("/wallet/topup/create", requireUser, (req, res) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "จำนวนเงินไม่ถูกต้อง"
    });
  }

  const transactionId =
    "TOPUP-" +
    Date.now() +
    "-" +
    crypto.randomBytes(4).toString("hex");

  db.query(
    "INSERT INTO topup_transactions (transaction_id, username, amount, status) VALUES (?, ?, ?, 'PENDING')",
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
          message: "สร้างรายการเติมเงินไม่สำเร็จ"
        });
      }

      res.json({
        success: true,
        transactionId: transactionId,
        amount: amount
      });
    }
  );
});

// =========================
// SIMULATE PAYMENT
// =========================

app.post(
  "/wallet/topup/pay-simulate/:transactionId",
  requireUser,
  (req, res) => {
    const transactionId = req.params.transactionId;

    db.beginTransaction((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Transaction Error"
        });
      }

      // ต้องเป็นรายการของผู้ใช้คนนี้เท่านั้น
      db.query(
        "SELECT amount, status FROM topup_transactions WHERE transaction_id = ? AND username = ? FOR UPDATE",
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
                message: "ไม่พบรายการเติมเงิน"
              });
            });
          }

          const transaction = rows[0];

          if (transaction.status === "SUCCESS") {
            return db.rollback(() => {
              res.status(400).json({
                success: false,
                message: "รายการนี้ชำระแล้ว"
              });
            });
          }

          const amount = Number(transaction.amount);

          // เพิ่มเงินให้ user คนปัจจุบัน
          db.query(
            "UPDATE wallet SET balance = balance + ? WHERE username = ?",
            [
              amount,
              req.username
            ],
            (err) => {
              if (err) {
                return db.rollback(() => {
                  res.status(500).json({
                    success: false,
                    message: "เพิ่มเงินไม่สำเร็จ"
                  });
                });
              }

              // เปลี่ยนสถานะ
              db.query(
                "UPDATE topup_transactions SET status = 'SUCCESS' WHERE transaction_id = ? AND username = ?",
                [
                  transactionId,
                  req.username
                ],
                (err) => {
                  if (err) {
                    return db.rollback(() => {
                      res.status(500).json({
                        success: false,
                        message: "อัปเดตสถานะไม่สำเร็จ"
                      });
                    });
                  }

                  db.commit((err) => {
                    if (err) {
                      return db.rollback(() => {
                        res.status(500).json({
                          success: false,
                          message: "Commit Error"
                        });
                      });
                    }

                    db.query(
                      "SELECT balance FROM wallet WHERE username = ? LIMIT 1",
                      [req.username],
                      (err, walletRows) => {
                        if (err || walletRows.length === 0) {
                          return res.status(500).json({
                            success: false,
                            message: "อ่านยอดเงินไม่สำเร็จ"
                          });
                        }

                        res.json({
                          success: true,
                          amount: amount,
                          balance: Number(
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
      "SELECT transaction_id, amount, status, created_at FROM topup_transactions WHERE username = ? ORDER BY created_at DESC",
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
      "SELECT * FROM purchase_history WHERE username = ? ORDER BY created_at DESC",
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
    const productId = Number(req.params.id);
    const amount = Number(req.body.amount);

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "จำนวนไม่ถูกต้อง"
      });
    }

    db.query(
      "UPDATE products SET stock = stock + ? WHERE id = ?",
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
// ESP32 COMMAND
// =========================

app.get("/command", (req, res) => {
  const command = commandQueue.shift() || 0;

  res.json({
    command: command
  });
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/login.html");
});

// =========================
// SERVER
// =========================

app.listen(
  process.env.PORT || 3000,
  "0.0.0.0",
  () => {
    console.log("================================");
    console.log("Vending Machine Server Running");
    console.log("================================");
    console.log("http://localhost:3000");
    console.log("Admin Password: 1234");
    console.log("ระบบหลายผู้ใช้พร้อมใช้งาน");
  }
);