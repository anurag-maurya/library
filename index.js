import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET, // encryption key
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect()
.then(() => console.log('Connected to PostgreSQL'))
.catch(err => console.error('Error connecting to PostgreSQL:', err));

let current_user;

app.get("/user", async (req, res) => {
  console.log("req user from callback : ", req.user);
  const userId = req.query?.userId || req.user?.id;
  let same_user;
  if (req.user?.id) {
    same_user = req.query?.userId ? req.query.userId == req.user.id : true;
  }
  console.log("user data=>", userId);
  console.log(req.query?.userId);
  console.log(req.user?.id);
  console.log("same user : ", same_user);
  const book = await db.query("SELECT * FROM books WHERE userId=$1", [userId]);
  const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);

  console.log("book==>", JSON.stringify(book.rows));
  res.render("user.ejs", {
    books: book.rows,
    user: user.rows[0],
    same_user: same_user,
  });
});

app.get("/", async (req, res) => {
  const books = await db.query(
    "SELECT userId, COUNT(*) FROM books GROUP BY userId"
  );
  const users = await db.query("SELECT * FROM users");
  console.log("user data=>", users.rows);
  console.log("book-->", books.rows);
  users.rows.forEach((user) => {
    const matchingBook = books.rows.find((book) => book.userid == user.id);
    user.count = matchingBook ? parseInt(matchingBook.count) : 0;
  });
  res.render("home.ejs", { users: users.rows });
});

app.get("/books", async (req, res) => {
  const books = await db.query("SELECT * FROM books");
  console.log("book-->", books.rows);
  res.render("books.ejs", { books: books.rows });
});

app.post("/edit", async (req, res) => {
  console.log("req body from edit", req.body);
  try {
    if (!!req.body.rating) {
      await db.query(
        "UPDATE books SET title = $2, readdate = $3, rating = $4, favourite = $5, description = $6, isbn = $7 WHERE id = $1",
        [
          req.body.bookId,
          req.body.title,
          req.body.readDate,
          req.body.rating,
          req.body?.favourite ? true : false,
          req.body.description,
          req.body.isbn,
        ]
      );
      res.redirect("/user");
    } else {
      const book = await db.query("SELECT * FROM books WHERE id = $1", [
        req.body.bookId,
      ]);
      const readdate = new Date(book.rows[0].readdate);

      // Extract the year, month, and day components
      const year = readdate.getFullYear();
      const month = String(readdate.getMonth() + 1).padStart(2, "0");
      const day = String(readdate.getDate()).padStart(2, "0");

      // Format the date as 'YYYY-MM-DD'
      book.rows[0].readdate = `${year}-${month}-${day}`;
      console.log("edit book==>", JSON.stringify(book.rows[0]));
      console.log("parsed date: ", book.rows[0].readdate);
      res.render("edit.ejs", { book: book.rows[0] });
    }
  } catch (error) {
    console.log("error in edit: ", error);
  }
});

app.post("/add", async (req, res) => {
  try {
    console.log("req body in add: ", req.body);
    const { title, readDate, rating, description, isbn, favourite, userId } =
      req.body;

    if (!rating) {
      return res.render("add.ejs", { userId: userId });
    }

    const values = [
      userId,
      title,
      readDate,
      rating,
      favourite ? true : false,
      description,
      isbn,
    ];

    await db.query(
      `
            INSERT INTO books(userid, title, readdate, rating, favourite, description, isbn)
            VALUES($1, $2, $3, $4, $5, $6, $7)
        `,
      values
    );

    res.redirect("/");
  } catch (error) {
    console.log("Error while adding data in table:", error);
    res.status(500).send("Error while adding data.");
  }
});

app.get("/addUser", async (req, res) => {
  res.render("addUser.ejs");
});

app.post("/addUser", async (req, res) => {
  console.log("Entered user detail: ", req.body);
  try {
    const { email, name, about, profileLink, password } = req.body;
    console.log("entered profilelink: ", profileLink);
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (checkResult.rows.length > 0) {
      res.send("Email already exists. Try logging in.");
    } else {
      // password hashing
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.log("error while hashing password: ", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (name, about, profilelink, email, password) VALUES ($1, $2, $3, $4, $5)",
            [name, about, profileLink, email, hash]
          );
          console.log(result);
          res.redirect("/login");
        }
      });
    }
  } catch (error) {
    console.log("error wile adding user: ", error);
  }
});

app.get("/login", async (req, res) => {
  res.render("login.ejs");
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/user",
    failureRedirect: "/login",
  })
);

app.post("/delete", async (req, res) => {
  console.log("BookId to delete: ", req.body.bookId);
  try {
    await db.query("DELETE FROM books WHERE id = $1", [req.body.bookId]);
  } catch (error) {
    console.log("Getting error while deleting the record: ", error);
  }
  res.redirect("/");
});

// this is middleware, it will automatically triggered whenever user try to login
passport.use(
  new Strategy(async function verify(username, password, cb) {
    // it can automatically get the value from ejs of username, password if it exists
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, result) => {
          if (err) {
            return cb(err);
          } else {
            if (result) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      return cb(err);
    }
  })
);

// serialize and deserialize is use to store session in local storage and remove session
passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`App is listening at port ${port}`);
});
