var mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
module.exports.isAdmin = async (req, res, next) => {
  let connection;
  let connect = async function () {
    connection = await mysql.createConnection({
    
    host: "localhost",
    user: "root",
    password: "@bubakar1243",
    database: "transport",
    insecureAuth: true,
    });
  };
  await connect();
  const [rows1] = await connection.execute(
    `select * from login where UserRole="Administrator"`
  );
  const [rows2] = await connection.execute(
    `select * from login where Email="${req.session.__id}"`
  );
  if (
    req.session.__id == rows1[0].Email &&
    rows2[0].AccPassword == rows1[0].AccPassword
  ) {
    console.log("inside if");
    return next();
  } else {
    req.flash(
      "error",
      "You must be Logged in as Admin to perform this operation"
    );
    return res.redirect("/login");
  }
};
module.exports.isLoggedIn = (req, res, next) => {
  if (!req.session.__id) {
    req.flash("error", "You must be logged in first");
    return res.redirect("/login");
  } else {
    next();
  }
};
