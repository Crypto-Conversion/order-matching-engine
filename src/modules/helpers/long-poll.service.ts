import * as expressLP from "express-longpoll";
import "rxjs/add/operator/delay";
import { Subject } from "rxjs/Subject";
import {DbHelper} from "./db.helper";
import {WsAdapter} from "../adapters/websocketadapter";

const uuidv4 = require("uuid/v4");

export class LongPollService {
  private static instance;
  private order: Subject<IOrder> = new Subject<IOrder>();
  private lp;
  private wsAdapter: WsAdapter;

  constructor() {
    if (LongPollService.instance) {
      throw new Error("Error - use Singleton.getInstance()");
    }

    this.order.delay(1000).subscribe(async (order: IOrder) => {
      const currentOrders = await DbHelper.GetMatchedOrders(order);

      if (currentOrders.length > 0) {
        const matchedOrder = currentOrders[0];

        const sideAResponse = {
          order_id: matchedOrder.id,
          side: "a",
        };
        const sideBResponse = {
          order_id: matchedOrder._id,
          side: "b",
          address: order.sellerAddress,
          depositAmount: order.sellAmount,
          from: order.sellCurrency,
          to: order.buyCurrency,
          // from: matchedOrder.sellerAddress,
          // to: order.sellerAddress,
        };

        await DbHelper.UpdateOrderStatus(order.id, "pending", matchedOrder.sellerAddress);
        await DbHelper.UpdateOrderStatus(matchedOrder.id, "pending", order.sellerAddress);

        // Broadcast message to all clients
        this.wsAdapter.broadcast("getActiveOrders");

        this.lp.publishToId("/order/:id/:address/:sellCurrency/:buyCurrency/:sellAmount/:buyAmount",
              matchedOrder.id, sideAResponse);

        this.lp.publishToId("/order/:id/:address/:sellCurrency/:buyCurrency/:sellAmount/:buyAmount",
              order.id, sideBResponse);
      }
    });
  }

  public static getInstance(): LongPollService {
    LongPollService.instance = LongPollService.instance || new LongPollService();
    return LongPollService.instance;
  }

  public async setExpressInstance(expressApp, wsAdapter) {
    this.wsAdapter = wsAdapter;
    this.lp = expressLP(expressApp);
    this.lp.create("/order/:id/:address/:sellCurrency/:buyCurrency/:sellAmount/:buyAmount", async (req, res, next) => {
      const id = req.params.id;
      req.id = id; // Long pool ID
      const order = {
        id,
        sellCurrency: req.params.sellCurrency,
        buyCurrency: req.params.buyCurrency,
        sellAmount: req.params.sellAmount,
        buyAmount: req.params.buyAmount,
        sellerAddress: req.params.address,
        status: "new",
      } as IOrder;

      let dbOrder = await DbHelper.GetOrderWithId(id);
      if (!dbOrder) {
        dbOrder = await DbHelper.PutOrder(order);
      }

      // Broadcast message to all clients
      this.wsAdapter.broadcast("getActiveOrders");

      this.order.next(dbOrder);
      console.log("CREATING ORDER", dbOrder.id);
      next();
    });
  }
}

export interface IOrder {
  id: string;
  sellCurrency: string;
  buyCurrency: string;
  status: string;
  buyerAddress: string;
  sellerAddress: string;
  sellAmount: number;
  buyAmount: number;
  expiration?: Date;
  wsId: number;
}
