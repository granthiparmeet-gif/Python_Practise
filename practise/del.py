# class College():
#     def __init__(self,name):
#         self.name = name

# s1 = College("Parmeet")
# print (s1)
# del s1
# print (s1)

class Account():
    def __init__(self, acc_no, acc_passkey):
        self.acc_no = acc_no
        self.__acc_passkey = acc_passkey

    def resetpass(self):
        print (self.__acc_passkey)

c1 = Account ("12345", "Siw7276")
print(c1.acc_no)
print(c1.resetpass())