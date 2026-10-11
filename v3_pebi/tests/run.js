'use strict';
// Тестовый набор «ПЕБИ»: node tests/run.js  (UPDATE_SNAPSHOT=1 node tests/run.js — обновить снапшот)
require('./t1_t2.test.js');
require('./t3_t4_t5.test.js');
require('./t6_t7_t8.test.js');
require('./t9_robustness.test.js');
const { summary } = require('./helpers.js');
summary();
