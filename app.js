if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const path = require("path");
const ejsmate = require("ejs-mate");
var mysql = require("mysql2/promise");
const catchAsync = require("./utils/catchAsync");
const ExpressError = require("./utils/ExpressError");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { storage, cloudinary } = require("./cloudinary/index.js");
const upload = multer({ storage });

const methodover = require("method-override");
const flash = require("connect-flash");
const session = require("express-session");
const { isAdmin, isLoggedIn } = require("./middleware");
const { chown } = require("fs");

//Connection Info
let con;
const connect = async function () {
  con = await mysql.createConnection({
   
    host: "localhost",
    user: "root",
    password: "@bubakar1243",
    database: "transport",
    insecureAuth: true,
  });
};
connect();

//setting express app
app = express();
app.engine("ejs", ejsmate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

app.use(express.urlencoded({ extended: true }));
app.use(methodover("_method"));
app.use(express.static(path.join(__dirname, "/public")));
const sessionConfig = {
  secret: "thisisasecret",
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};
app.use(session(sessionConfig));
app.use(flash());
app.use(async (req, res, next) => {
  res.locals.current_user = req.session.__id;
  res.locals.admin = null;
  const [rows] = await con.execute(
    `select Email from login where UserRole="Administrator"`
  );
  if (rows[0].Email == req.session.__id) {
    res.locals.admin = req.session.__id;
  }
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

app.get("/", (req, res) => {
  res.render("Users/login.ejs");
});
app.get("/login", (req, res) => {
  res.render("Users/login.ejs");
});
app.get(
  "/home",
  
  async (req, res) => {
    const value = await con.execute(
      `select SUM(Amount) AS SUMM from payment where MONTH(PaymentDate)= (MONTH(now())+ INTERVAL 1 MONTH) and YEAR(PaymentDate)=YEAR(now());`
    );
    const [rows1] = await con.execute(
      `SELECT SUM(Amount) total FROM payment WHERE YEAR(PaymentDate) = YEAR(now())`
    ); //for annual earnings
    const [rows2] = await con.execute(`SELECT COUNT(*) p_req FROM requests`); //pending requests
    const [rows3] = await con.execute(
      `SELECT DestName,COUNT(*) count FROM student WHERE Enddate IS NULL GROUP BY DestName`
    ); //Query for pie chart
    const [rows4] = await con.execute(
      `SELECT COUNT(*) new_count FROM student WHERE MONTH(StartDate)=MONTH(now())`
    );
    const [rows5] = await con.execute(
      `SELECT SUM(Amount) m_count FROM payment WHERE Year(PaymentDate)=Year(now()) GROUP BY MONTH(PaymentDate)`
    );
    const [rows6] = await con.execute(`select * from destinations`)
    let DName=[]
    let EFare =[]
    for (row of rows6){
      DName.push(row.DestName)
    }
    for (let row of rows6){
      EFare.push(row.EquivDFare)
    }

    res.render("Home.ejs", {
      item: value,
      Annual_earnings: rows1[0].total,
      pending_requests: rows2[0].p_req,
      pie: rows3[0],
      new_users: rows4[0].new_count,
      monthly_count: rows5[0].m_count,
      DName,EFare
    });
  })
;

//Handling Requests (Admin page)

app.get(
  "/admin/requests",
 
  async (req, res) => {
    const [rows1] = await con.execute(
      `SELECT * from requests where AdminAction="Pending" order by RequestDate desc`
    );
    res.render("Users/admin_requests.ejs", { requests: rows1 });
  })
;

// sending requests response to database

app.get(
  "/admin/requests/:request_id/:response",
  
  
  async (req, res) => {
    const { request_id, response } = req.params;
    await con.execute(
      `update requests set AdminAction="${response}" where requestID=${request_id}`
    );
    res.redirect(`/admin/requests`);
  }
);

//Register Students,Drivers,Employees

app.get(
  "/register",
  
  catchAsync(async (req, res) => {
    const [rows1] =
      await con.execute(`SELECT route.RouteID RouteID,route_destinations.DestName DestName FROM route
  join route_destinations on (route.RouteID=route_destinations.RouteID)
  where Status="inactive" order by route.RouteID`);
    const [rows2] = await con.execute(`SELECT * FROM transport.vehicle
  where VehicleNo not in (select VehicleNo from (driver));`);
    let destinations_route = [];
    for (let row of rows1) {
      if (!destinations_route.includes(row.RouteID)) {
        destinations_route.push(row.RouteID);
      }
      destinations_route.push(row.DestName);
    }
    const [destinations] = await con.execute(`select * from destinations`);
    res.render("Users/register.ejs", {
      destinations,
      destinations_route,
      vehicles: rows2,
    });
  })
);

//registering a student

app.post(
  "/student/register",
  
  catchAsync(async (req, res) => {
    const [rows1] = await con.execute(
      `select * from student where CmsID=${req.body.cms}`
    );
    const [rows2] = await con.execute(
      `select * from login where Email="${req.body.email}"`
    );
    if (rows1[0]) {
      req.flash("error", "Student with this CMS ID already exists");
      return res.redirect("/register");
    }
    if (rows2[0]) {
      req.flash("error", "Student with this Email already exists");
      return res.redirect("/register");
    }
    
    const hash = await bcrypt.hash(req.body.password, 12);
    const [rows3] =
      await con.execute(`select DriverID from driver where RouteID in (
    select RouteID from route where RouteID in(
    select RouteID from route_destinations where DestName = "${req.body.dest_name_student}")
    and ShiftTime = "${req.body.timings}") limit 1`);
    let sql_statement1 =
      `INSERT INTO student VALUES ` +
      `("${req.body.first_name}", "${req.body.last_name}", "${req.body.phnumber}"
  ,"${req.body.cms}","${req.body.email}","${req.body.address}","${req.body.department}",null,
  "${req.body.dest_name_student}","${rows3[0].DriverID}","${req.body.starting_date}",null,null)`;
    let sql_statement2 =
      `INSERT INTO login VALUES ` +
      `("${req.body.email}", "${hash}", "Student","1")`;
    await con.execute(sql_statement2);
    await con.execute(sql_statement1);
    const [rows4] = await con.execute(`
  select FreeSlots,RouteID from route where RouteID=(select RouteID from Driver where DriverID=${rows3[0].DriverID})
  and vehicleno = (select vehicleno from Driver where DriverID=${rows3[0].DriverID})
  and ShiftTime="${req.body.timings}"`);
    await con.execute(
      `update route set FreeSlots=${rows4[0].FreeSlots - 1} where RouteID="${
        rows4[0].RouteID
      }"`
    );
    const [rows5] = await con.execute(
      "select max(ChallanNum) max_id from payment"
    );
    const [rows6] = await con.execute(
      `select * from destinations where DestName="${req.body.dest_name_student}"`
    );
    await con.execute(`insert into payment values
                (${rows5[0].max_id + 1},DATE_ADD(CURDATE(), INTERVAL 30 DAY),${
      rows6[0].EquivDFare},"Unpaid","${req.body.cms}")`);
    req.flash("success", "Registered Student Successfully");
    res.redirect("/register");
  })
);

//dynamic change of student register

app.post(
  "/student/register/get_timings",
  
  catchAsync(
  async (req, res) => {
    const rows =
      await con.execute(`select ShiftTime from route where RouteID in (
    select distinct RouteID from route_destinations where DestName="${req.body.dest_name}")
    and FreeSlots>0`);
    res.json({
      msg: "success",
      timings: rows,
    });
  }
));

// student Invoice

app.get("/student/invoice", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  const [rows] = await con.execute(
    `SELECT * from payment_requests where AdminAction="Pending"`
  );
  res.render("Users/student_invoice.ejs", { rows });
}));

//action on students payment details sent
app.get(
  "/student/invoice/:p_request_id/:response",
  isLoggedIn,
  isAdmin,
  catchAsync(
  async (req, res) => {
    const { p_request_id, response } = req.params;
    const [rows] = await con.execute(`select * from payment where ChallanNum=
                 (select ChallanNum from payment_requests where P_requestID=${p_request_id})
                 and Amount=(select PaidAmount from payment_requests where P_requestID=${p_request_id})`);
    if (!rows[0] && response == "Paid") {
      req.flash("error", "Pending Payment Not Found");
      return res.redirect(`/student/invoice`);
    }
    if (response == "Unpaid") {
      await con.execute(
        `update payment_requests set AdminAction="${response}" where P_requestID=${p_request_id}`
      );
      req.flash("success", "Set request as Unpaid");
      return res.redirect(`/student/invoice`);
    }
    await con.execute(
      `update payment_requests set AdminAction="${response}" where P_requestID=${p_request_id}`
    );
    await con.execute(`update payment set PaidStatus="${response}" where ChallanNum=
  (select ChallanNum from payment_requests where P_requestID=${p_request_id}) `);
    req.flash("success", "Stauts set as Unpaid");
    res.redirect(`/student/invoice`);
  }
));

// registering a driver

app.post(
  "/driver/register",
  
  catchAsync(async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 12);
    const [rows1] = await con.execute(
      "select max(DriverID) max_id from driver"
    );
    const [rows2] = await con.execute(
      `select * from login where Email="${req.body.email}"`
    );
    if (rows2[0]) {
      req.flash("error", "Driver with this Email already exists");
      return res.redirect("/register");
    }
    let sql_statement2 =
      `INSERT INTO driver VALUES ` +
      `("${rows1[0].max_id + 1}", "${req.body.first_name}", "${
        req.body.last_name
      }", "${req.body.phnumber}"
  ,"${req.body.email}","${req.body.cnic}","${req.body.vehicle}",
  "${req.body.route}","${req.body.address}","${req.body.date}",null,null,null)`;
    let sql_statement1 =
      `INSERT INTO login VALUES ` +
      `("${req.body.email}", "${hash}", "Driver","1")`;
    await con.execute(sql_statement1);
    await con.execute(sql_statement2);
    const [rows3] = await con.execute(
      `select NumOfSeats from vehicle where VehicleNo="${req.body.vehicle}"`
    );
    await con.execute(`update route
  set Status="active" ,VehicleNo="${req.body.vehicle}" ,FreeSlots=${rows3[0].NumOfSeats} where RouteID="${req.body.route}"`);
    await con.execute(`insert into dsalary values
                     (${
                       rows1[0].max_id + 1
                     },DATE_ADD(CURDATE(), INTERVAL 30 DAY),50000,"Unpaid")`);
    req.flash("success", "Registered Driver Successfully");
    res.redirect("/register");
  })
);

//dynamic change of driver register

app.post(
  "/driver/register/get_timings",
  
  catchAsync(
  async (req, res) => {
    const rows = await con.execute(
      `select ShiftTime from route where RouteID ="${req.body.route_id}"`
    );
    res.json({
      msg: "success",
      timings: rows,
    });
  }
));

// Driver Salary

app.get("/driver/salary", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  const [rows] = await con.execute(
    `SELECT * FROM dsalary d JOIN driver dr USING (DriverID) where PaidStatus="Unpaid"`
  );
  res.render("Users/driver_salary.ejs", { rows });
}));

//response on setting driver salary as paid
app.get(
  "/driver/salary/:id/:response",
  isLoggedIn,
  isAdmin,
  catchAsync(
  async (req, res) => {
    const { id, response } = req.params;
    await con.execute(
      `update dsalary set PaidStatus="Paid" where DriverID=${id}`
    );
    req.flash("success", "Set Paid Successfully");
    res.redirect("/driver/salary");
  }
));

//registering an Employee

app.post(
  "/employee/register",
  
  catchAsync(async (req, res, next) => {
    const hash = await bcrypt.hash(req.body.password, 12);
    const [rows1] = await con.execute("select max(EmpID) max_id from employee");
    const [rows2] = await con.execute(
      `select * from login where Email="${req.body.email}"`
    );
    if (rows2[0]) {
      req.flash("error", "Employee with this Email already exists");
      return res.redirect("/register");
    }
    let sql_statement2 =
      `INSERT INTO employee VALUES ` +
      `("${rows1[0].max_id + 1}", "${req.body.first_name}", "${
        req.body.last_name
      }", "${req.body.phnumber}"
  ,"${req.body.email}", "${req.body.date}",null,"${req.body.address}","${
        req.body.job_name
      }",null,null)`;
    let sql_statement1 =
      `INSERT INTO login VALUES ` +
      `("${req.body.email}", "${hash}", "Employee","1")`;
    await con.execute(sql_statement1);
    await con.execute(sql_statement2);
    const [rows3] = await con.execute(
      `select * from empdetails where JobName="${req.body.job_name}"`
    );
    await con.execute(`insert into esalary
                       values     
                  (${rows1[0].max_id + 1},DATE_ADD(CURDATE(), INTERVAL 30 DAY),${
      rows3[0].SalAmnt
    },"Unpaid")`);
    req.flash("success", "Registered Employee Successfully");
    res.redirect("/register");
  })
);

//  employee salary

app.get("/employee/salary", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  const [rows] = await con.execute(
    `SELECT * FROM esalary e JOIN employee em USING (EmpID) where PaidStatus="Unpaid"`
  );
  res.render("Users/employee_salary.ejs", { rows });
}));

//response on setting employee salary as paid
app.get(
  "/employee/salary/:id/:response",
  isLoggedIn,
  isAdmin,
  catchAsync(
  async (req, res) => {
    const { id, response } = req.params;
    await con.execute(`update esalary set PaidStatus="Paid" where EmpID=${id}`);
    req.flash("success", "Set Paid Successfully");
    res.redirect("/employee/salary");
  }
));

//Manage Students
app.get(
  "/managestudents",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    const [rows] = await con.query(`select * from student`);
    res.render("Users/managestudents.ejs", { rows });
  })
);
app.get(
  "/searchstudents",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    var searchdata = req.query.searchdata;
    var sql =
      "select * from student WHERE FirstName LIKE '%" +
      searchdata +
      "%' OR LastName LIKE '%" +
      searchdata +
      "%' OR Email LIKE '%" +
      searchdata +
      "%' OR CmsID LIKE '%" +
      searchdata +
      "%' OR Phone LIKE'%" +
      searchdata +
      "%' OR DestName LIKE '%" +
      searchdata +
      "%' OR DriverID LIKE '%" +
      searchdata +
      "%' OR Enddate LIKE '%" +
      searchdata +
      "%'";
    const [rows] = await con.query(sql);
    res.render("Users/managestudents.ejs", { rows });
  })
);
app.get(
  "/searchvehicles",
  catchAsync(async (req, res) => {
    var searchdata = req.query.searchdata;
    var sql =
      "select * from vehicle WHERE VehicleNo LIKE '%" +
      searchdata +
      "%' OR NumOfSeats LIKE '%" +
      searchdata +
      "%' OR Color LIKE '%" +
      searchdata +
      "%' OR Model LIKE '%" +
      searchdata +
      "%'";
    const [rows] = await con.query(sql);
    res.render("Users/managevehicles.ejs", { rows });
  })
);

//Manage Drivers
app.get(
  "/managedrivers",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    const [rows] = await con.query(`select * from driver`);
    res.render("Users/managedrivers.ejs", { rows });
  })
);

app.get(
  "/searchdrivers",
  
  catchAsync(async (req, res) => {
    var searchdata = req.query.searchdata;
    var sql =
      "select * from driver WHERE FirstName LIKE '%" +
      searchdata +
      "%' OR LastName LIKE '%" +
      searchdata +
      "%' OR Email LIKE '%" +
      searchdata +
      "%' OR CNIC LIKE '%" +
      searchdata +
      "%' OR Phone LIKE'%" +
      searchdata +
      "%' OR RouteID LIKE '%" +
      searchdata +
      "%' OR vehicleno LIKE '%" +
      searchdata +
      "%' OR EndDate LIKE '%" +
      searchdata +
      "%' OR DriverID LIKE '%" +
      searchdata +
      "%'";
    const [rows] = await con.query(sql);
    res.render("Users/managedrivers.ejs", { rows });
  })
);

//Manage Employees
app.get(
  "/employees/manage",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    const [rows] = await con.query(`select * from employee`);
    res.render("Users/manageemployees.ejs", { rows });
  })
);
app.get(
  "/searchemployees",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    var searchdata = req.query.searchdata;
    var sql =
      "select * from employee WHERE FirstName LIKE '%" +
      searchdata +
      "%' OR LastName LIKE '%" +
      searchdata +
      "%' OR EmpID LIKE '%" +
      searchdata +
      "%' OR Email LIKE '%" +
      searchdata +
      "%' OR Phone LIKE'%" +
      searchdata +
      "%' OR JobName LIKE '%" +
      searchdata +
      "%' OR endDate LIKE '%" +
      searchdata +
      "%'";
    const [rows] = await con.query(sql);
    res.render("Users/manageemployees.ejs", { rows });
  })
);
app.get(
  "/routes/manage",
  isLoggedIn,
  isAdmin,
  catchAsync(async (req, res) => {
    let destination_array = [];
    const [rows1] = await con.execute(`select * from destinations`);
    const [rows2] = await con.execute(
      `SELECT distinct RouteID,ShiftTime FROM route order by RouteID`
    );

    for (let row of rows2) {
      let [rows3] =
        await con.execute(`SELECT DestName FROM route_destinations where 
      RouteID='${row.RouteID}' order by RouteID`);
      for (let row3 of rows3) {
        destination_array.push(row3.DestName);
      }
    }

    res.render("Users/manageroutes.ejs", {
      destination_list: rows1,
      route_ids: rows2,
      destination_array,
    });
  })
);

//Add new Destination

app.post("/destinations/new", catchAsync( async (req, res) => {
  const [rows1] = await con.execute(
    `select * from destinations where DestName="${req.body.destination_name}"`
  );
  if (rows1[0]) {
    req.flash("error", "Destination with this name already exists");
    return res.redirect("/routes/manage");
  }
  const sql_statement1 =
    `INSERT INTO destinations VALUES ` +
    `("${req.body.destination_name}", ${req.body.student_fare})`;
  await con.execute(sql_statement1);
  req.flash("success", "Added New Destination");
  res.redirect("/routes/manage");
}));

//Render Edit Destination

app.get("/destination/:id/edit", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  let destination_array = [];
  const [rows1] = await con.execute(`select * from destinations`);
  const [rows2] = await con.execute(
    `SELECT distinct RouteID,ShiftTime FROM route order by RouteID`
  );

  for (let row of rows2) {
    let [rows3] =
      await con.execute(`SELECT DestName FROM route_destinations where 
      RouteID='${row.RouteID}' order by RouteID`);
    for (let row3 of rows3) {
      destination_array.push(row3.DestName);
    }
  }
  const { id } = req.params;
  const [rows4] = await con.execute(
    `select * from destinations where DestName="${id}"`
  );
  res.render("Users/manageroutes_edit_destinations.ejs", {
    upd_destination: rows4[0],
    destination_list: rows1,
    route_ids: rows2,
    destination_array,
  });
}));
//Edit Destination

app.put("/destination/:id", catchAsync( async (req, res) => {
  const { id } = req.params;
  await con.execute(`Update destinations set EquivDFare=${req.body.student_fare}
  where DestName ="${id}"`);
  req.flash("success", "Destination Fare updated Successfully");
  res.redirect("/routes/manage");
}));

//Delete Destination

app.delete("/destination/:id", catchAsync( async (req, res) => {
  const { id } = req.params;
  const [rows1] = await con.execute(
    `SELECT distinct DestName FROM route_destinations;`
  );
  for (let row of rows1) {
    if (row.DestName == id) {
      req.flash("error", "Destination Exist in Routes");
      return res.redirect("/routes/manage");
    }
  }
  await con.execute(`Delete from destinations where DestName="${id}"`);
  req.flash("success", "Destination Deleted Successfully");
  res.redirect("/routes/manage");
}));

//Add new Routes

app.post(
  "/routes/new",
  catchAsync(async (req, res) => {
    const [rows1] = await con.execute(
      `select * from route where RouteID="${req.body.route_id}"`
    );
    if (rows1[0]) {
      req.flash("error", "Route with this ID already exists");
      return res.redirect("/routes/manage");
    }
    if (
      req.body.station_1 == req.body.station_2 ||
      req.body.station_2 == req.body.station_3 ||
      req.body.station_3 == req.body.station_1
    ) {
      req.flash("error", "All Stations must be Unique");
      return res.redirect("/routes/manage");
    }
    const sql_statement1 =
      `INSERT INTO route VALUES ` +
      `("${req.body.route_id}",null,null,"${req.body.time}","inactive")`;
    const sql_statement2 =
      `INSERT INTO route_destinations VALUES ` +
      `("${req.body.route_id}","${req.body.station_1}")`;
    const sql_statement3 =
      `INSERT INTO route_destinations VALUES ` +
      `("${req.body.route_id}","${req.body.station_2}")`;
    const sql_statement4 =
      `INSERT INTO route_destinations VALUES ` +
      `("${req.body.route_id}","${req.body.station_3}")`;

    await con.execute(sql_statement1);
    await con.execute(sql_statement2);
    await con.execute(sql_statement3);
    await con.execute(sql_statement4);
    req.flash("success", "Added New Route");
    res.redirect("/routes/manage");
  })
);

//Delete Routes

app.delete("/routes/:id", catchAsync( async (req, res) => {
  const { id } = req.params;
  const [rows1] = await con.execute(
    `select * from driver where RouteID="${id}"`
  );
  if (rows1[0]) {
    const [rows2] = await con.execute(
      `select * from student where DriverID="${rows1[0].DriverID}"`
    );
    if (rows2[0]) {
      req.flash("error", "Routte is Assigned to Student");
      return res.redirect("/routes/manage");
    }
  }
  await con.execute(`Delete from route_destinations where RouteID="${id}"`);
  await con.execute(`Delete from route where RouteID="${id}"`);
  req.flash("success", "Route Deleted Successfully");
  res.redirect("/routes/manage");
}));



//manage Vehicle
app.get("/vehicle/manage", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  const [rows] = await con.execute(
    `select * from vehicle where Enddate is Null`
  );
  res.render("Users/managevehicles.ejs", { rows });
}));

//add new vehicle
app.post("/vehicle/new", isLoggedIn, isAdmin,catchAsync( async (req, res) => {
  const[rows] = await con.execute(`select * from vehicle where VehicleNo="${req.body.vehicle_no}"`)
  if(rows[0]){
    console.log("herreee")
    req.flash("error","Vehicle with this id already exists")
    return res.redirect("/vehicle/manage");
  }
  const sql_statement1 =
    `INSERT INTO vehicle VALUES ` +
    `("${req.body.vehicle_no}", ${req.body.total_seats}, "${req.body.color}","${req.body.model}",null)`;
  await con.execute(sql_statement1);
  req.flash("success", "Registered Vehicle Successfully");
  res.redirect("/vehicle/manage");
}));

//delete vehicle
app.delete("/vehicle/:id", catchAsync( async (req, res) => {
  const { id } = req.params;
  const [rows] = await con.execute(`select * from driver where vehicleno="${id}"`);
  console.log(rows[0])
  if (rows[0]) {
    req.flash("error", "Canot Delete vehicle Assigned to Driver");
    return res.redirect("/vehicle/manage")
  }
  await con.execute(`Delete from vehicle where VehicleNo="${id}"`);
  req.flash("success", "vehicle Deleted Successfully");
  res.redirect("/vehicle/manage");
}));

//taking payment details to database

app.post("/user/profile/:id/payment",catchAsync( async (req, res) => {
  const { id } = req.params;
  const [admin_account] = await con.execute(
    `select * from login where UserRole="Administrator"`
  );
  if (admin_account[0].Email == req.session.__id) {
    req.flash("error", "Canot Add Payment Details From Admin Account");
    return res.redirect(`/user/profile/${id}`);
  }
  const [rows1] = await con.execute(
    `select * from student where Email="${id}"`
  );
  const [rows2] = await con.execute(
    "select max(P_requestID) max_id from payment_requests"
  );
  let sql_statement1 = `insert into payment_requests values
                      ("${rows2[0].max_id + 1}","${rows1[0].CmsID}",${
    req.body.challan_num
  },"${req.body.transaction_id}"
                      ,"${rows1[0].FirstName} ${rows1[0].LastName}",${
    req.body.payment_amount
  },CURDATE(),"Pending")`;
  await con.execute(sql_statement1);
  req.flash("success", "Added Request. Wait for response from Admin");
  res.redirect(`/user/profile/${id}`);
}));

// taking requests to Database

app.post("/user/profile/:id/request", isLoggedIn,catchAsync( async (req, res) => {
  const { id } = req.params;
  const [admin_account] = await con.execute(
    `select * from login where UserRole="Administrator"`
  );
  if (admin_account[0].Email == req.session.__id) {
    req.flash("error", "Canot make Request From Admin Account");
    return res.redirect(`/user/profile/${id}`);
  }
  const [account] = await con.execute(
    `select * from login where Email="${id}"`
  );
  if (account[0].UserRole == "Student") {
    const [rows1] = await con.execute(
      `select * from student where Email="${id}"`
    );
    const [rows2] = await con.execute(
      `select max(requestID) max_id from requests`
    );
    let sql_statement1 = `insert into requests values
                      (${rows2[0].max_id + 1},"Student","${rows1[0].CmsID}","${
      rows1[0].FirstName
    } ${rows1[0].LastName}",CURDATE(),
                      "${req.body.student_request}","Pending")`;
    await con.execute(sql_statement1);
    return res.redirect(`/user/profile/${id}`);
  } else if (account[0].UserRole == "Employee") {
    const [rows1] = await con.execute(
      `select * from Employee where Email="${id}"`
    );
    const [rows2] = await con.execute(
      `select max(requestID) max_id from requests`
    );
    let sql_statement1 = `insert into requests values
                     (${rows2[0].max_id + 1},"Employee","${rows1[0].EmpID}","${
      rows1[0].FirstName
    } ${rows1[0].LastName}",CURDATE(),
                     "${req.body.employee_request}","Pending")`;
    await con.execute(sql_statement1);
    return res.redirect(`/user/profile/${id}`);
  } else {
    const [rows1] = await con.execute(
      `select * from Driver where Email="${id}"`
    );
    const [rows2] = await con.execute(
      `select max(requestID) max_id from requests`
    );
    let sql_statement1 = `insert into requests values
                     (${rows2[0].max_id + 1},"Driver","${rows1[0].DriverID}","${
      rows1[0].FirstName
    } ${rows1[0].LastName}",CURDATE(),
                     "${req.body.driver_request}","Pending")`;
    await con.execute(sql_statement1);
    return res.redirect(`/user/profile/${id}`);
  }
}));

//discontinuing profile
  
app.delete("/user/profile/:id",catchAsync( async(req,res)=>{
        const {id} = req.params;
        const [account] = await con.execute(
          `select * from login where Email="${id}"`
        );
        if (account[0].UserRole == "Student") {
        await con.execute(`update student set Enddate=CURDATE() where Email="${id}"`)
        await con.execute(`update login set UserStatus=0 where Email="${id}"`)
        const [rows1] =await con.execute(`select FreeSlots from route where RouteID=(
          select RouteID from driver where DriverID=(
          select DriverID from student where Email="${id}"));`);
        await con.execute(`update route set FreeSlots=${rows1[0].FreeSlots+1} 
        where RouteID=(
          select RouteID from driver where DriverID=(
          select DriverID from student where Email="${id}"))`)
        req.flash("success","Account Removed")
        res.render("Users/login.ejs")
          }

}))



//image upload to profiles

app.post(
  "/user/profile/:id/imageUpload",
  upload.array("image"),
  catchAsync(
  async (req, res) => {
    const { id } = req.params;
    const [admin_account] = await con.execute(
      `select * from login where UserRole="Administrator"`
    );
    if (admin_account[0].Email == req.session.__id) {
      req.flash("error", "Canot Add image From Admin Account");
      return res.redirect(`/user/profile/${id}`);
    }
    const [account] = await con.execute(
      `select * from login where Email="${id}"`
    );
    if (account[0].UserRole == "Student") {
      await con.execute(
        `update student set image_url="${req.files[0].path}", file_name="${req.files[0].filename}" where Email="${id}"`
      );
      return res.redirect(`/user/profile/${id}`);
    } else if (account[0].UserRole == "Employee") {
      await con.execute(
        `update employee set image_url="${req.files[0].path}", file_name="${req.files[0].filename}" where Email="${id}"`
      );
      return res.redirect(`/user/profile/${id}`);
    } else {
      await con.execute(
        `update driver set image_url="${req.files[0].path}", file_name="${req.files[0].filename}" where Email="${id}"`
      );
      return res.redirect(`/user/profile/${id}`);
    }
  }
));

app.get(
  "/user/profile/:id",
  isLoggedIn,
  catchAsync(async (req, res) => {
    if (req.params.id == "a") {
      id = req.session.__id;
    } else {
      id = req.params.id;
    }
    let email1 = req.params.id;
    let email2 = req.session.__id;
    const [account1] = await con.execute(
      `select * from login where Email="${email1}"`
    );
    const [account2] = await con.execute(
      `select * from login where Email="${email2}"`
    );
    if (
      (account1[0] && account1[0].UserRole == "Student") ||
      (account2[0] && account2[0].UserRole == "Student")
    ) {
      let rows1;
      if (account1[0] && account1[0].UserRole == "Student") {
        rows1 = await con.execute(
          `select * from student where Email="${email1}"`
        );
      } else if (account2[0] && account2[0].UserRole == "Student") {
        rows1 = await con.execute(
          `select * from student where Email="${email2}"`
        );
      }
      const [rows2] = await con.execute(
        `select * from driver where DriverID=${rows1[0][0].DriverID}`
      );
      const [rows3] = await con.execute(
        `select * from route where RouteID="${rows2[0].RouteID}"`
      );
      const [rows4] = await con.execute(
        `select * from destinations where DestName="${rows1[0][0].DestName}"`
      );
      const [rows5] = await con.execute(
        `select * from requests where UserID="${rows1[0][0].CmsID}" and UserRole="Student" order by RequestDate`
      );
      const [rows6] = await con.execute(
        `select * from payment where CmsID="${rows1[0][0].CmsID}"`
      );
      return res.render("Users/student_profile.ejs", {
        id,
        info: rows1[0][0],
        Driver: rows2[0],
        Route: rows3[0],
        Destination: rows4[0],
        request_info: rows5,
        Payments: rows6,
      });
    } else if (
      (account1[0] && account1[0].UserRole == "Driver") ||
      (account2[0] && account2[0].UserRole == "Driver")
    ) {
      let rows1;
      if (account1[0] && account1[0].UserRole == "Driver") {
        rows1 = await con.execute(
          `select * from driver where Email="${email1}"`
        );
      } else if (account2[0] && account2[0].UserRole == "Driver") {
        rows1 = await con.execute(
          `select * from driver where Email="${email2}"`
        );
      }

      const [rows2] = await con.execute(
        `select * from route where RouteID="${rows1[0][0].RouteID}"`
      );
      const [rows3] = await con.execute(
        `select * from dsalary where DriverID=${rows1[0][0].DriverID}`
      );
      const [rows4] = await con.execute(
        `select * from requests where UserID="${rows1[0][0].DriverID}" and UserRole="Driver" order by RequestDate`
      );
      return res.render("Users/driver_profile.ejs", {
        Driver: rows1[0][0],
        Route: rows2[0],
        Dr_details: rows3,
        request_info: rows4,
      });
    } else if (
      (account1[0] && account1[0].UserRole == "Employee") ||
      (account2[0] && account2[0].UserRole == "Employee")
    ) {
      let rows1;
      if (account1[0] && account1[0].UserRole == "Employee") {
        rows1 = await con.execute(
          `select * from employee where Email="${email1}"`
        );
      } else if (account2[0] && account2[0].UserRole == "Employee") {
        rows1 = await con.execute(
          `select * from employee where Email="${email2}"`
        );
      }
      const [rows2] = await con.execute(
        `select * from ESalary where EmpID=${rows1[0][0].EmpID}`
      );
      const [rows3] = await con.execute(
        `select * from requests where UserID="${rows1[0][0].EmpID}" and UserRole="Employee" order by RequestDate`
      );
      return res.render("Users/employee_profile.ejs", {
        Employee: rows1[0][0],
        Emp_details: rows2,
        request_info: rows3,
      });
    } else {
      req.flash("error", "Profile Not Found");
      return res.redirect("/home");
    }
  })
);

app.get("/logout", isLoggedIn, (req, res) => {
  req.session.__id = null;
  req.flash("success", "Logged Out Successfully");
  res.redirect("/login");
});
app.post(
  "/login",
  async (req, res) => {
    const Email = req.body.username;
    const AccPassword = req.body.password;
    const UserRole = req.body.role;
    const [rows] = await con.execute(
      `select * from login where Email="${Email}"`
    );
    if (rows[0]) {
      const validPass = await bcrypt.compare(AccPassword, rows[0].AccPassword);
      if (validPass && rows[0].UserRole == UserRole && rows[0].UserStatus==1) {
        req.session.__id = Email;
        req.flash("success", "Logged in Successfully");
        res.redirect("/login");
      } else {
        req.flash("error", "Incorrect Id or Password");
        res.redirect("/login");
      }
    } else {
      req.flash("error", "Incorrect Id or Password");
      res.redirect("/login");
    }
  })
;

app.get(
  "/user",
  isLoggedIn,
  isAdmin,
  catchAsync((req, res) => {
    const users = ["Abubakar", "emaan", "Umair"];
    throw new ExpressError();
    res.render("user.ejs", { users });
  })
);
app.all("*", (req, res, next) => {
  next(new ExpressError("404 Not Found", 404));
});
app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong" } = err;
  res.status(statusCode);
  return res.redirect("/home");
});

app.listen(3000, () => {
  console.log("Started listening at port 3000");
});
