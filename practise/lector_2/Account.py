class Account():
    def __init__(self, acc_no, balance):
        self.acc_no = acc_no
        self.balance = balance

    def debit(self, amt_debit):
        self.balance = self.balance - amt_debit
        print(f"The amount you debited from {self.acc_no} is {amt_debit} and the balance is {self.balance}")

    def credit(self, amt_credit):
        self.balance = self.balance + amt_credit
        print(f"The amount you credited to {self.acc_no} is {amt_credit} and the balance is {self.balance}")

customer1 = Account(2358273, 20000)
print(customer1.acc_no)
print(customer1.balance)

customer1.debit(100)
customer1.credit(100)
customer1.credit(200)
customer1.credit(300)
