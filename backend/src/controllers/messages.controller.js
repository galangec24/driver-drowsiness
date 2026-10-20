const { z } = require('zod');
const Driver = require('../models/Driver');
const User = require('../models/User');
const Message = require('../models/Message');
const HttpError = require('../utils/httpError');
const alertDispatcher = require('../services/alertDispatcher');
const carLink = require('../services/callSignaling');

const sendSchema = z.object({
  text: z.string().trim().min(1).max(200),
  kind: z.enum(['message', 'reminder']).optional().default('message'),
});

async function ownedDriver(req) {
  const d = await Driver.findOne({ _id: req.params.id, parentId: req.user.parentId })
    .select('_id name parentId')
    .lean()
    .catch(() => null);
  if (!d) throw new HttpError(404, 'Driver not found');
  return d;
}

/** Send to the car now if it is online, else it waits (pending) for the car to reconnect. */
async function send(req, res) {
  const driver = await ownedDriver(req);
  const user = await User.findById(req.user.parentId).select('name').lean();
  const msg = await Message.create({
    driverId: driver._id,
    parentId: req.user.parentId,
    fromName: (user && user.name) || '',
    text: req.body.text,
    kind: req.body.kind,
  });
  const online = await carLink.deliverMessage(msg);
  res.status(201).json({ message: msg.toPublic(), carOnline: online });
}

async function list(req, res) {
  const driver = await ownedDriver(req);
  const msgs = await Message.find({ driverId: driver._id }).sort({ createdAt: -1 }).limit(30);
  res.json({ messages: msgs.map((m) => m.toPublic()) });
}

/** The car confirmed it read the message to the driver. */
async function markDelivered(messageId, driverId) {
  const msg = await Message.findOneAndUpdate(
    { _id: messageId, driverId, status: 'pending' },
    { status: 'delivered', deliveredAt: new Date() },
    { new: true },
  ).catch(() => null);
  if (msg) {
    alertDispatcher.emitToParent(msg.parentId.toString(), 'message:delivered', msg.toPublic());
  }
  return msg;
}

module.exports = { send, list, markDelivered, sendSchema };
