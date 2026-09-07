const express = require("express");
const mysql = require("mysql2");
const crypto = require("crypto");

const app = express();

app.use(express.json());
app.use(express.static(__dirname));


// ==================================================
// MySQL
// ==================================================

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "vending_machine"
});

db.connect((err) => {

    if (err) {
        console.log("เชื่อม MySQL ไม่สำเร็จ");
        console.log(err);
        return;
    }

    console.log("เชื่อม MySQL สำเร็จ");

});


// ==================================================
// ESP32 COMMAND
// ==================================================

let pendingCommand = 0;


// ==================================================
// ADMIN SECURITY
// ==================================================

const ADMIN_PASSWORD = "1234";

const adminTokens = new Set();


// ==================================================
// ADMIN LOGIN
// ==================================================

app.post("/admin/login", (req, res) => {

    const password = String(req.body.password || "");

    if (password !== ADMIN_PASSWORD) {

        return res.status(401).json({
            success: false,
            message: "รหัสผ่านไม่ถูกต้อง"
        });

    }

    const token =
        crypto.randomBytes(32).toString("hex");

    adminTokens.add(token);

    console.log("Admin Login สำเร็จ");

    res.json({
        success: true,
        message: "เข้าสู่ระบบ Admin สำเร็จ",
        token: token
    });

});


// ==================================================
// CHECK ADMIN
// ==================================================

function requireAdmin(req, res, next) {

    const token =
        req.headers["x-admin-token"];

    if (!token || !adminTokens.has(token)) {

        return res.status(401).json({
            success: false,
            message: "ไม่มีสิทธิ์จัดการระบบ"
        });

    }

    next();

}


// ==================================================
// ADMIN LOGOUT
// ==================================================

app.post(
    "/admin/logout",
    requireAdmin,
    (req, res) => {

        const token =
            req.headers["x-admin-token"];

        adminTokens.delete(token);

        console.log("Admin Logout");

        res.json({
            success: true,
            message: "ออกจากระบบแล้ว"
        });

    }
);


// ==================================================
// PRODUCTS
// ==================================================

app.get("/products", (req, res) => {

    db.query(
        "SELECT * FROM products",
        (err, results) => {

            if (err) {

                console.log(err);

                return res.status(500).json({
                    success: false,
                    message: "Database error"
                });

            }

            res.json(results);

        }
    );

});


// ==================================================
// BUY PRODUCT
// ==================================================

app.post("/buy/:id", (req, res) => {

    const productId =
        Number(req.params.id);

    const username = "PICKK";


    // ตรวจ ID สินค้า
    if (!Number.isInteger(productId) || productId <= 0) {

        return res.json({
            success: false,
            message: "รหัสสินค้าไม่ถูกต้อง"
        });

    }


    // เริ่ม Transaction
    db.beginTransaction((err) => {

        if (err) {

            console.log(err);

            return res.status(500).json({
                success: false,
                message: "เริ่มรายการซื้อไม่ได้"
            });

        }


        // ==================================================
        // ตรวจสินค้า
        // ==================================================

        db.query(
            `SELECT
                name,
                price,
                stock
             FROM products
             WHERE id = ?
             FOR UPDATE`,
            [productId],
            (err, products) => {

                if (err) {

                    console.log(err);

                    return db.rollback(() => {

                        res.status(500).json({
                            success: false,
                            message: "Database error"
                        });

                    });

                }


                // ไม่พบสินค้า
                if (products.length === 0) {

                    return db.rollback(() => {

                        res.json({
                            success: false,
                            message: "ไม่พบสินค้า"
                        });

                    });

                }


                const productName =
                    products[0].name;

                const price =
                    Number(products[0].price);

                const stock =
                    Number(products[0].stock);


                // ==================================================
                // ตรวจ Stock
                // ==================================================

                if (stock <= 0) {

                    return db.rollback(() => {

                        res.json({
                            success: false,
                            message: "สินค้าหมด"
                        });

                    });

                }


                // ==================================================
                // ตรวจ Wallet
                // ==================================================

                db.query(
                    `SELECT balance
                     FROM wallet
                     WHERE username = ?
                     FOR UPDATE`,
                    [username],
                    (err, wallets) => {

                        if (err) {

                            console.log(err);

                            return db.rollback(() => {

                                res.status(500).json({
                                    success: false,
                                    message: "Database error"
                                });

                            });

                        }


                        // ไม่พบ Wallet
                        if (wallets.length === 0) {

                            return db.rollback(() => {

                                res.json({
                                    success: false,
                                    message: "ไม่พบ Wallet"
                                });

                            });

                        }


                        const balance =
                            Number(wallets[0].balance);


                        // ==================================================
                        // เงินไม่พอ
                        // ==================================================

                        if (balance < price) {

                            return db.rollback(() => {

                                res.json({
                                    success: false,
                                    message: "เงินไม่พอ"
                                });

                            });

                        }


                        // ==================================================
                        // หัก Wallet
                        // ==================================================

                        db.query(
                            `UPDATE wallet
                             SET balance = balance - ?
                             WHERE username = ?`,
                            [
                                price,
                                username
                            ],
                            (err) => {

                                if (err) {

                                    console.log(err);

                                    return db.rollback(() => {

                                        res.status(500).json({
                                            success: false,
                                            message: "หัก Wallet ไม่สำเร็จ"
                                        });

                                    });

                                }


                                // ==================================================
                                // ลด Stock
                                // ==================================================

                                db.query(
                                    `UPDATE products
                                     SET stock = stock - 1
                                     WHERE id = ?`,
                                    [productId],
                                    (err) => {

                                        if (err) {

                                            console.log(err);

                                            return db.rollback(() => {

                                                res.status(500).json({
                                                    success: false,
                                                    message: "ลด Stock ไม่สำเร็จ"
                                                });

                                            });

                                        }


                                        // ==================================================
                                        // บันทึกประวัติการซื้อ
                                        // ==================================================

                                        db.query(
                                            `INSERT INTO purchase_history
                                            (
                                                username,
                                                product_id,
                                                product_name,
                                                price
                                            )
                                            VALUES (?, ?, ?, ?)`,
                                            [
                                                username,
                                                productId,
                                                productName,
                                                price
                                            ],
                                            (err) => {

                                                if (err) {

                                                    console.log(err);

                                                    return db.rollback(() => {

                                                        res.status(500).json({
                                                            success: false,
                                                            message:
                                                                "บันทึกประวัติการซื้อไม่สำเร็จ"
                                                        });

                                                    });

                                                }


                                                // ==================================================
                                                // COMMIT
                                                // ==================================================

                                                db.commit((err) => {

                                                    if (err) {

                                                        console.log(err);

                                                        return db.rollback(() => {

                                                            res.status(500).json({
                                                                success: false,
                                                                message:
                                                                    "บันทึกรายการไม่สำเร็จ"
                                                            });

                                                        });

                                                    }


                                                    // ==================================================
                                                    // ส่งคำสั่งให้ ESP32
                                                    // ==================================================

                                                    pendingCommand =
                                                        productId;


                                                    console.log(
                                                        "ซื้อสำเร็จ → Product " +
                                                        productId +
                                                        " → ESP32"
                                                    );


                                                    // ==================================================
                                                    // ส่งผลกลับเว็บ
                                                    // ==================================================

                                                    res.json({

                                                        success: true,

                                                        message:
                                                            "ซื้อสินค้าสำเร็จ",

                                                        productId:
                                                            productId,

                                                        productName:
                                                            productName,

                                                        price:
                                                            price,

                                                        balance:
                                                            balance - price

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


// ==================================================
// GET WALLET
// ==================================================

app.get(
    "/wallet/:username",
    (req, res) => {

        const username =
            req.params.username;


        db.query(
            `SELECT balance
             FROM wallet
             WHERE username = ?`,
            [username],
            (err, results) => {

                if (err) {

                    console.log(err);

                    return res.status(500).json({
                        success: false,
                        message: "Database error"
                    });

                }


                if (results.length === 0) {

                    return res.status(404).json({
                        success: false,
                        message: "ไม่พบผู้ใช้"
                    });

                }


                res.json({

                    success: true,

                    username:
                        username,

                    balance:
                        Number(results[0].balance)

                });

            }

        );

    }

);


// ==================================================
// CREATE TOPUP
// ==================================================

app.post(
    "/wallet/topup/create",
    (req, res) => {

        const username = "PICKK";

        const amount =
            Number(req.body.amount);


        // ตรวจจำนวนเงิน
        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            return res.json({
                success: false,
                message: "จำนวนเงินไม่ถูกต้อง"
            });

        }


        // จำกัดทศนิยม 2 ตำแหน่ง
        const finalAmount =
            Math.round(amount * 100) / 100;


        // สร้าง Transaction ID
        const transactionId =
            "TOPUP-" +
            Date.now() +
            "-" +
            crypto
                .randomBytes(3)
                .toString("hex")
                .toUpperCase();


        db.query(
            `INSERT INTO topup_transactions
            (
                transaction_id,
                username,
                amount,
                status
            )
            VALUES (?, ?, ?, 'PENDING')`,
            [
                transactionId,
                username,
                finalAmount
            ],
            (err) => {

                if (err) {

                    console.log(err);

                    return res.status(500).json({
                        success: false,
                        message:
                            "สร้างรายการเติมเงินไม่สำเร็จ"
                    });

                }


                console.log(
                    "สร้างรายการเติมเงิน → " +
                    transactionId +
                    " → " +
                    finalAmount +
                    " บาท"
                );


                res.json({

                    success: true,

                    transactionId:
                        transactionId,

                    amount:
                        finalAmount,

                    status:
                        "PENDING"

                });

            }

        );

    }

);


// ==================================================
// SIMULATE PAYMENT
// ==================================================

app.post(
    "/wallet/topup/pay-simulate/:transactionId",
    (req, res) => {

        const transactionId =
            req.params.transactionId;


        db.beginTransaction((err) => {

            if (err) {

                return res.status(500).json({
                    success: false,
                    message: "เริ่มรายการไม่ได้"
                });

            }


            // ล็อก Transaction
            db.query(
                `SELECT *
                 FROM topup_transactions
                 WHERE transaction_id = ?
                 FOR UPDATE`,
                [transactionId],
                (err, transactions) => {

                    if (err) {

                        return db.rollback(() => {

                            res.status(500).json({
                                success: false,
                                message: "Database error"
                            });

                        });

                    }


                    if (transactions.length === 0) {

                        return db.rollback(() => {

                            res.json({
                                success: false,
                                message:
                                    "ไม่พบรายการเติมเงิน"
                            });

                        });

                    }


                    const transaction =
                        transactions[0];


                    // ป้องกันจ่ายซ้ำ
                    if (
                        transaction.status ===
                        "SUCCESS"
                    ) {

                        return db.rollback(() => {

                            res.json({
                                success: false,
                                message:
                                    "รายการนี้ชำระเงินไปแล้ว"
                            });

                        });

                    }


                    if (
                        transaction.status !==
                        "PENDING"
                    ) {

                        return db.rollback(() => {

                            res.json({
                                success: false,
                                message:
                                    "รายการนี้ไม่สามารถชำระได้"
                            });

                        });

                    }


                    const username =
                        transaction.username;

                    const amount =
                        Number(transaction.amount);


                    // เพิ่ม Wallet
                    db.query(
                        `UPDATE wallet
                         SET balance = balance + ?
                         WHERE username = ?`,
                        [
                            amount,
                            username
                        ],
                        (err, result) => {

                            if (err) {

                                return db.rollback(() => {

                                    res.status(500).json({
                                        success: false,
                                        message:
                                            "เติม Wallet ไม่สำเร็จ"
                                    });

                                });

                            }


                            if (
                                result.affectedRows === 0
                            ) {

                                return db.rollback(() => {

                                    res.json({
                                        success: false,
                                        message:
                                            "ไม่พบ Wallet"
                                    });

                                });

                            }


                            // เปลี่ยนสถานะ
                            db.query(
                                `UPDATE topup_transactions
                                 SET
                                    status = 'SUCCESS',
                                    paid_at = NOW()
                                 WHERE transaction_id = ?`,
                                [transactionId],
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


                                    // Commit
                                    db.commit((err) => {

                                        if (err) {

                                            return db.rollback(() => {

                                                res.status(500).json({
                                                    success: false,
                                                    message:
                                                        "บันทึกรายการไม่สำเร็จ"
                                                });

                                            });

                                        }


                                        // อ่าน Wallet ใหม่
                                        db.query(
                                            `SELECT balance
                                             FROM wallet
                                             WHERE username = ?`,
                                            [username],
                                            (err, wallets) => {

                                                if (err) {

                                                    return res.status(500).json({
                                                        success: false,
                                                        message:
                                                            "อ่าน Wallet ไม่สำเร็จ"
                                                    });

                                                }


                                                console.log(
                                                    "เติมเงินสำเร็จ → " +
                                                    transactionId +
                                                    " → +" +
                                                    amount
                                                );


                                                res.json({

                                                    success: true,

                                                    message:
                                                        "จำลองการชำระเงินสำเร็จ",

                                                    transactionId:
                                                        transactionId,

                                                    amount:
                                                        amount,

                                                    balance:
                                                        Number(
                                                            wallets[0]
                                                                .balance
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


// ==================================================
// TOPUP HISTORY
// ==================================================

app.get(
    "/wallet/topup/history/:username",
    (req, res) => {

        const username =
            req.params.username;


        db.query(
            `SELECT
                transaction_id,
                amount,
                status,
                created_at,
                paid_at
             FROM topup_transactions
             WHERE username = ?
             ORDER BY id DESC
             LIMIT 20`,
            [username],
            (err, results) => {

                if (err) {

                    console.log(err);

                    return res.status(500).json({
                        success: false,
                        message:
                            "โหลดประวัติไม่สำเร็จ"
                    });

                }


                res.json({

                    success: true,

                    history:
                        results

                });

            }

        );

    }

);


// ==================================================
// PURCHASE HISTORY
// ==================================================

app.get(
    "/purchase/history/:username",
    (req, res) => {

        const username =
            req.params.username;


        db.query(
            `SELECT
                id,
                product_id,
                product_name,
                price,
                created_at
             FROM purchase_history
             WHERE username = ?
             ORDER BY id DESC
             LIMIT 20`,
            [username],
            (err, results) => {

                if (err) {

                    console.log(err);

                    return res.status(500).json({
                        success: false,
                        message:
                            "โหลดประวัติการซื้อไม่สำเร็จ"
                    });

                }


                res.json({

                    success: true,

                    history:
                        results

                });

            }

        );

    }

);


// ==================================================
// ADD STOCK - ADMIN ONLY
// ==================================================

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

            return res.json({
                success: false,
                message:
                    "จำนวน Stock ไม่ถูกต้อง"
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

                    console.log(err);

                    return res.status(500).json({
                        success: false,
                        message:
                            "เพิ่ม Stock ไม่สำเร็จ"
                    });

                }


                if (
                    result.affectedRows === 0
                ) {

                    return res.json({
                        success: false,
                        message:
                            "ไม่พบสินค้า"
                    });

                }


                console.log(
                    "Admin เพิ่ม Stock → Product " +
                    productId +
                    " +" +
                    amount
                );


                res.json({

                    success: true,

                    message:
                        "เพิ่ม Stock สำเร็จ"

                });

            }

        );

    }

);


// ==================================================
// ESP32 COMMAND
// ==================================================

app.get(
    "/command",
    (req, res) => {

        const command =
            pendingCommand;


        pendingCommand = 0;


        console.log(
            "ESP32 ขอคำสั่ง → " +
            command
        );


        res.json({

            command:
                command

        });

    }

);


// ==================================================
// SERVER
// ==================================================

app.listen(
    process.env.PORT || 3000,
    "0.0.0.0",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "VENDING SERVER RUNNING"
        );

        console.log(
            "================================"
        );

        console.log(
            "http://localhost:3000"
        );

        console.log(
            "Admin Password: 1234"
        );

        console.log(
            "ระบบเติมเงินจำลองพร้อมใช้งาน"
        );

    }
);