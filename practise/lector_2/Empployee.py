class Employee():
    def __init__(self, role, department, salary):
        self.role = role
        self.department = department
        self.salary = salary

    def showdetails(self):
        print(f" The role is {self.role} \n The department is {self.department} \n The salary is {self.salary}")

class Engineer(Employee):
    def __init__(self, name , age):
        self.name = name
        self.age = age
        super().__init__("Engineer","CSE", "23500")


e2=Engineer("Elon Musk", 23)
e2.showdetails()