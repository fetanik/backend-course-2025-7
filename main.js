require('dotenv').config(); 
const mysql = require('mysql2');

const { Command } = require('commander');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const program = new Command();
program
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port')
  .requiredOption('-c, --cache <dir>', 'cache directory');

program.parse(process.argv);
const options = program.opts();

// створюємо папку кешу, якщо її ще нема
if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// підключення до MySQL
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || 'lab7user',
  password: process.env.DB_PASSWORD || 'lab7pass',
  database: process.env.DB_NAME || 'lab7db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// завантаження фото у кеш
const upload = multer({ dest: options.cache });

// функція для відповідей 
function itemToDto(item) {
  const photoFilename = item.photoFilename || item.photo_filename || null;

  return {
    id: item.id,
    inventory_name: item.inventory_name,
    description: item.description,
    photoUrl: photoFilename ? `/inventory/${item.id}/photo` : null,
  };
}

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service',
      version: '1.0.0',
      description: 'Simple inventory API for lab work',
    },
    components: {
      schemas: {
        InventoryItem: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            inventory_name: { type: 'string' },
            description: { type: 'string' },
            photoUrl: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  apis: [__filename],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 405 для заборонених методів
app.all('/register', (req, res, next) => {
  if (req.method === 'POST') return next();
  res.sendStatus(405);
});
app.all('/inventory', (req, res, next) => {
  if (req.method === 'GET') return next();
  res.sendStatus(405);
});
app.all('/inventory/:id', (req, res, next) => {
  if (['GET', 'PUT', 'DELETE'].includes(req.method)) return next();
  res.sendStatus(405);
});
app.all('/inventory/:id/photo', (req, res, next) => {
  if (['GET', 'PUT'].includes(req.method)) return next();
  res.sendStatus(405);
});
app.all('/search', (req, res, next) => {
  if (req.method === 'POST') return next();
  res.sendStatus(405);
});

// HTML-форми
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'RegisterForm.html'));
});
app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'SearchForm.html'));
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Get all inventory items
 *     responses:
 *       200:
 *         description: List of inventory items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/InventoryItem'
 */
app.get('/inventory', (req, res) => {
  dbPool.query(
    'SELECT id, inventory_name, description, photo_filename FROM inventory ORDER BY id',
    (err, rows) => {
      if (err) {
        console.error('GET /inventory error:', err);
        return res.status(500).json({ error: 'internal error' });
      }
      res.json(rows.map(itemToDto));
    }
  );
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get inventory item by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Inventory item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Not found
 */
app.get('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  dbPool.query(
    'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error('GET /inventory/:id error:', err);
        return res.status(500).json({ error: 'internal error' });
      }

      if (!rows.length) {
        return res.status(404).json({ error: 'not found' });
      }

      res.json(itemToDto(rows[0]));
    }
  );
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Update inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Not found
 */
app.put('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const { inventory_name, description } = req.body;

  // перевіряємо чи такий запис існує
  dbPool.query(
    'SELECT id FROM inventory WHERE id = ?',
    [id],
    (err, existing) => {
      if (err) {
        console.error('PUT /inventory/:id check error:', err);
        return res.status(500).json({ error: 'internal error' });
      }

      if (!existing.length) {
        return res.status(404).json({ error: 'not found' });
      }

      // оновлюємо тільки те що прийшло в body
      dbPool.query(
        `UPDATE inventory
         SET inventory_name = COALESCE(?, inventory_name),
             description    = COALESCE(?, description)
         WHERE id = ?`,
        [
          typeof inventory_name === 'string' ? inventory_name : null,
          typeof description === 'string' ? description : null,
          id,
        ],
        (err2) => {
          if (err2) {
            console.error('PUT /inventory/:id update error:', err2);
            return res.status(500).json({ error: 'internal error' });
          }

          // повертаємо актуальні дані
          dbPool.query(
            'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
            [id],
            (err3, rows) => {
              if (err3) {
                console.error('PUT /inventory/:id select error:', err3);
                return res.status(500).json({ error: 'internal error' });
              }

              res.json(itemToDto(rows[0]));
            }
          );
        }
      );
    }
  );
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get photo for inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Photo file
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Photo not found
 */
app.get('/inventory/:id/photo', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  dbPool.query(
    'SELECT photo_filename FROM inventory WHERE id = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error('GET /inventory/:id/photo error:', err);
        return res.status(500).json({ error: 'internal error' });
      }

      if (!rows.length || !rows[0].photo_filename) {
        return res.status(404).json({ error: 'photo not found' });
      }

      const photoFilename = rows[0].photo_filename;
      const filePath = path.resolve(options.cache, photoFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'photo not found' });
      }

      res.setHeader('Content-Type', 'image/jpeg');
      fs.createReadStream(filePath).pipe(res);
    }
  );
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Upload or replace photo for inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Item with updated photo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Not found
 */
app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'invalid id' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'photo file is required' });
  }

  //  дістаємо item, щоб знати старе фото
  dbPool.query(
    'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error('PUT /inventory/:id/photo select error:', err);
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'internal error' });
      }

      if (!rows.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'not found' });
      }

      const item = rows[0];

      //  якщо було старе фото то пробуємо видалити файл
      if (item.photo_filename) {
        const oldPath = path.join(options.cache, item.photo_filename);
        if (fs.existsSync(oldPath)) {
          fs.unlink(oldPath, () => {});
        }
      }

      const newPhotoFilename = path.basename(req.file.path);

      //  записуємо нове ім'я фото в БД
      dbPool.query(
        'UPDATE inventory SET photo_filename = ? WHERE id = ?',
        [newPhotoFilename, id],
        (err2) => {
          if (err2) {
            console.error('PUT /inventory/:id/photo update error:', err2);
            fs.unlink(req.file.path, () => {});
            return res.status(500).json({ error: 'internal error' });
          }

          //  повертаємо оновлений item
          dbPool.query(
            'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
            [id],
            (err3, updatedRows) => {
              if (err3) {
                console.error('PUT /inventory/:id/photo reselect error:', err3);
                return res.status(500).json({ error: 'internal error' });
              }

              res.json(itemToDto(updatedRows[0]));
            }
          );
        }
      );
    }
  );
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search inventory item by id (HTML response)
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               has_photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: HTML page with search result
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       404:
 *         description: Item not found
 */
app.post('/search', (req, res) => {
  const id = parseInt(req.body.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).send('Invalid id');
  }

  dbPool.query(
    'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error('POST /search error:', err);
        return res.status(500).send('Internal error');
      }

      if (!rows.length) {
        return res.status(404).send('Item not found');
      }

      const item = rows[0];

      let description = item.description || '';
      let photoBlock = '';

      // якщо у формі поставили checkbox і фото є
      if (req.body.has_photo !== undefined && item.photo_filename) {
        const photoUrl = `/inventory/${item.id}/photo`;
        if (description) {
          description += '<br>';
        }
        description += `Photo link: <a href="${photoUrl}">${photoUrl}</a>`;

        photoBlock = `
          <p>
            <img src="${photoUrl}"
                 alt="photo of ${item.inventory_name}"
                 style="max-width:300px;">
          </p>
        `;
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Search result</title>
        </head>
        <body>
          <h1>Search result</h1>
          <p><strong>ID:</strong> ${item.id}</p>
          <p><strong>Name:</strong> ${item.inventory_name}</p>
          <p><strong>Description:</strong><br>${description}</p>
          ${photoBlock}
          <p><a href="/SearchForm.html">Back to search</a></p>
        </body>
        </html>
      `);
    }
  );
});

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register new inventory item
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *             required:
 *               - inventory_name
 *     responses:
 *       201:
 *         description: Created item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       400:
 *         description: Bad request
 */
app.post('/register', upload.single('photo'), (req, res) => {
  const name = req.body.inventory_name;
  const description = req.body.description || '';

  if (!name || name.trim() === '') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'inventory_name is required' });
  }

  const photoFilename = req.file ? path.basename(req.file.path) : null;

  dbPool.query(
    `INSERT INTO inventory (inventory_name, description, photo_filename)
     VALUES (?, ?, ?)`,
    [name.trim(), description, photoFilename],
    (err, result) => {
      if (err) {
        console.error('POST /register error:', err);
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'internal error' });
      }

      const insertedId = result.insertId;

      // повертаємо щойно створений запис
      dbPool.query(
        'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
        [insertedId],
        (err2, rows) => {
          if (err2) {
            console.error('POST /register select error:', err2);
            return res.status(500).json({ error: 'internal error' });
          }

          res.status(201).json(itemToDto(rows[0]));
        }
      );
    }
  );
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Delete inventory item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted item
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InventoryItem'
 *       404:
 *         description: Not found
 */
app.delete('/inventory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  //  беремо item перед видаленням
  dbPool.query(
    'SELECT id, inventory_name, description, photo_filename FROM inventory WHERE id = ?',
    [id],
    (err, rows) => {
      if (err) {
        console.error('DELETE /inventory/:id select error:', err);
        return res.status(500).json({ error: 'internal error' });
      }

      if (!rows.length) {
        return res.status(404).json({ error: 'not found' });
      }

      const item = rows[0];

      // видаляємо з БД
      dbPool.query(
        'DELETE FROM inventory WHERE id = ?',
        [id],
        (err2) => {
          if (err2) {
            console.error('DELETE /inventory/:id delete error:', err2);
            return res.status(500).json({ error: 'internal error' });
          }

          //  видаляємо файл фото з кешу (якщо є)
          if (item.photo_filename) {
            const filePath = path.join(options.cache, item.photo_filename);
            if (fs.existsSync(filePath)) {
              fs.unlink(filePath, () => {});
            }
          }

          res.json(itemToDto(item));
        }
      );
    }
  );
});


const server = http.createServer(app);
server.listen(options.port, options.host, () => {
  console.log(`Server running at http://${options.host}:${options.port}/`);
  console.log(`Cache directory: ${path.resolve(options.cache)}`);
});
